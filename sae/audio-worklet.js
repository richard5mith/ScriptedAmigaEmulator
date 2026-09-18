/* Buffered browser audio output for SAE. GPL-2.0-or-later. */
class SAEAudioOutput extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frames=options.processorOptions.frames;
    this.channels=options.processorOptions.channels;
    this.queue=[];
    this.offset=0;
    this.pending=false;
    this.epoch=0;
    this.paused=false;
    this.muted=false;
    this.port.onmessage=({data})=>{
      if(data.type==='state') {
        this.paused=!!data.paused;this.muted=!!data.muted;
        this.queue=[];this.offset=0;this.pending=false;++this.epoch;
      } else if(data.type==='samples'&&data.epoch===this.epoch&&this.pending) {
        this.pending=false;
        if(!this.paused&&Array.isArray(data.channels)&&data.channels.length===this.channels&&
          data.channels.every(c=>c instanceof Float32Array&&c.length===this.frames))this.queue.push(data.channels);
      }
    };
  }
  process(inputs,outputs) {
    const output=outputs[0];
    for(const channel of output)channel.fill(0);
    if(this.paused||!output.length)return true;
    let written=0;
    while(written<output[0].length&&this.queue.length) {
      const block=this.queue[0],count=Math.min(this.frames-this.offset,output[0].length-written);
      if(!this.muted)for(let ch=0;ch<output.length;ch++) {
        const samples=block[Math.min(ch,block.length-1)];
        output[ch].set(samples.subarray(this.offset,this.offset+count),written);
      }
      written+=count;this.offset+=count;
      if(this.offset===this.frames){this.queue.shift();this.offset=0;}
    }
    // One outstanding request, at most two blocks queued. No SharedArrayBuffer
    // or cross-origin isolation is required. Silence on underrun, never repeat.
    if(this.queue.length<2&&!this.pending) {
      this.pending=true;this.port.postMessage({type:'request',epoch:this.epoch});
    }
    return true;
  }
}
registerProcessor('sae-audio-output',SAEAudioOutput);
