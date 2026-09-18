const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function processor(channels=2,frames=8){
 let Processor;const messages=[];
 class Base {constructor(){this.port={postMessage:m=>messages.push(m)};}}
 vm.runInNewContext(fs.readFileSync(require.resolve('../sae/audio-worklet.js'),'utf8'),{AudioWorkletProcessor:Base,Float32Array,registerProcessor:(_,value)=>Processor=value});
 const p=new Processor({processorOptions:{frames,channels}});
 const render=(size=4)=>{const out=Array.from({length:channels},()=>new Float32Array(size));assert.equal(p.process([],[out]),true);return out.map(a=>Array.from(a));};
 const send=data=>p.port.onmessage({data});
 const fill=(value,epoch=p.epoch)=>send({type:'samples',epoch,channels:Array.from({length:channels},(_,ch)=>new Float32Array(frames).fill(value+ch))});
 return {p,messages,render,send,fill};
}
test('worklet streams stereo blocks, fills underruns with silence and bounds requests',()=>{
 const {p,messages,render,fill}=processor();
 assert.deepEqual(render(),[[0,0,0,0],[0,0,0,0]]);render();assert.equal(messages.length,1);
 fill(0.25);assert.deepEqual(render(),[[.25,.25,.25,.25],[1.25,1.25,1.25,1.25]]);
 fill(.5);fill(9);assert.equal(p.queue.length,2,'unsolicited blocks are discarded');
 assert.deepEqual(render(8),[[.25,.25,.25,.25,.5,.5,.5,.5],[1.25,1.25,1.25,1.25,1.5,1.5,1.5,1.5]]);
 assert.deepEqual(render(8),[[.5,.5,.5,.5,0,0,0,0],[1.5,1.5,1.5,1.5,0,0,0,0]]);
});
test('pause/reset discards stale requests and mute consumes without playing queued audio',()=>{
 const {p,messages,render,send,fill}=processor(1);
 render();const old=p.epoch;fill(.5);send({type:'state',paused:true,muted:false});
 assert.deepEqual(render(),[[0,0,0,0]]);const count=messages.length;render();assert.equal(messages.length,count);
 send({type:'state',paused:false,muted:false});render();fill(9,old);assert.equal(p.queue.length,0);
 fill(.5);assert.deepEqual(render(),[[.5,.5,.5,.5]]);
 send({type:'state',paused:false,muted:true});render();fill(.75);assert.deepEqual(render(),[[0,0,0,0]]);
 send({type:'state',paused:false,muted:false});assert.deepEqual(render(),[[0,0,0,0]]);
});
test('malformed sample blocks are discarded and can be requested again',()=>{
 const {p,send,render,messages}=processor();render();
 send({type:'samples',epoch:p.epoch,channels:[new Float32Array(1)]});assert.equal(p.queue.length,0);
 render();assert.equal(messages.length,2);
});
