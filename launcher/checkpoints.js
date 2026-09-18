/* Compressed, checksummed machine checkpoints. GPL-2.0-or-later. */
var SAECheckpoint = (function() {
  'use strict';
  const MAX_BYTES=384*1024*1024;
  async function digest(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');}
  function word(value){const data=new Uint8Array(4);new DataView(data.buffer).setUint32(0,value,true);return data;}
  async function pack(machine){
    if(typeof CompressionStream==='undefined')throw new Error('This browser cannot compress save states.');
    const buffers=[];
    const nodes=machine.nodes.map(node=>{if(node.type!=='buffer')return node;buffers.push(node.data);return {type:'buffer',data:buffers.length-1};});
    const json=JSON.stringify({...machine,nodes},(key,value)=>value===undefined?{$saeNumber:'undefined'}:typeof value==='number'&&(!Number.isFinite(value)||Object.is(value,-0))?{$saeNumber:String(value===0?'-0':value)}:value);
    const metadata=new TextEncoder().encode(json),parts=[word(metadata.length),metadata,word(buffers.length)];
    for(const buffer of buffers)parts.push(word(buffer.byteLength),buffer);
    const raw=new Blob(parts);if(raw.size>MAX_BYTES)throw new Error('Save state exceeds the size limit.');
    const data=await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return {format:1,data,hash:await digest(await data.arrayBuffer())};
  }
  async function unpack(record){
    if(record?.format!==1||!(record.data instanceof Blob)||record.data.size>MAX_BYTES)throw new Error('Invalid save state.');
    if(await digest(await record.data.arrayBuffer())!==record.hash)throw new Error('The saved position is damaged.');
    const reader=record.data.stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks=[];let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw new Error('Save state exceeds the size limit.');chunks.push(value);}}
    finally{await reader.cancel();}
    const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}offset=0;
    const view=new DataView(data.buffer);
    function readWord(){if(offset+4>size)throw new Error('Truncated save state.');const value=view.getUint32(offset,true);offset+=4;return value;}
    const length=readWord();if(offset+length>size)throw new Error('Truncated save state.');
    const undefinedValue={};
    const machine=JSON.parse(new TextDecoder().decode(data.subarray(offset,offset+length)),(key,value)=>value&&typeof value==='object'&&Object.keys(value).length===1&&'$saeNumber'in value?(value.$saeNumber==='undefined'?undefinedValue:Number(value.$saeNumber)):value);offset+=length;
    const count=readWord(),buffers=[];if(count>100000)throw new Error('Invalid save state buffers.');
    for(let i=0;i<count;i++){const length=readWord();if(offset+length>size)throw new Error('Truncated save state buffer.');buffers.push(data.buffer.slice(offset,offset+length));offset+=length;}
    if(offset!==size||!Array.isArray(machine.nodes))throw new Error('Invalid save state data.');
    for(const node of machine.nodes)if(node.type==='record'||node.type==='values'){for(const key of Object.keys(node.data))if(node.data[key]===undefinedValue)node.data[key]=undefined;}
    for(const node of machine.nodes)if(node.type==='buffer'){if(!Number.isInteger(node.data)||!buffers[node.data])throw new Error('Invalid save state buffer.');node.data=buffers[node.data];}
    return machine;
  }
  return {pack,unpack};
})();
if(typeof module!=='undefined')module.exports=SAECheckpoint;
