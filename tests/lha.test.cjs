const gamePath = require('node:fs').existsSync('games/Turrican.lha') ? 'games/Turrican.lha' : 'Turrican.lha';
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const ctx=vm.createContext({Uint8Array,DataView,Blob,DecompressionStream,TextDecoder,
 SAEF_String2Array:s=>Uint8Array.from(s,c=>c.charCodeAt(0)),SAEF_Array2String:a=>Buffer.from(a).toString('latin1')});
for(const name of ['lha','archive','ffs','whdload','media'])vm.runInContext(fs.readFileSync('sae/'+name+'.js','utf8'),ctx);
function header(name,data,level=0,method='-lh0-',packed=data) {
 name=Buffer.from(name); data=Buffer.from(data); packed=Buffer.from(packed);
 let h;
 if(level<2) {
  h=Buffer.alloc((level===0?24:27)+name.length);h[0]=h.length-2;h[21]=name.length;name.copy(h,22);h.writeUInt16LE(ctx.SAEF_LHA.crc16(data),22+name.length);
 } else {
  const field=level===3?4:2, extStart=level===3?28:24;
  h=Buffer.alloc(extStart+field+1+name.length+field);
  if(level===2)h.writeUInt16LE(h.length);else {h.writeUInt16LE(4);h.writeUInt32LE(h.length,24);}
  h.writeUInt16LE(ctx.SAEF_LHA.crc16(data),21);
  if(field===2)h.writeUInt16LE(field+1+name.length,extStart);else h.writeUInt32LE(field+1+name.length,extStart);
  h[extStart+field]=1;name.copy(h,extStart+field+1);
 }
 h.write(method,2,'ascii');h.writeUInt32LE(packed.length,7);h.writeUInt32LE(data.length,11);h[20]=level;
 if(level<2)h[1]=h.subarray(2).reduce((a,b)=>(a+b)&255,0);
 return Buffer.concat([h,packed,Buffer.from([0])]);
}
function repeated(method,value,count) {
 const parts=[], put=(value,n)=>parts.push(value.toString(2).padStart(n,'0'));
 put(count,16);put(0,5);put(0,5);put(0,9);put(value,9);
 const bits=/[67]/.test(method)?5:4;put(0,bits);put(0,bits);
 let stream=parts.join('');stream=stream.padEnd(Math.ceil(stream.length/8)*8,'0');
 return Buffer.from(stream.match(/.{8}/g).map(s=>parseInt(s,2)));
}
for(const level of [0,1,2,3])for(const method of ['-lh0-','-lh4-','-lh5-','-lh6-','-lh7-'])test('LHA level '+level+' '+method,async()=>{
 const expected=Buffer.alloc(64,65), packed=method==='-lh0-'?expected:repeated(method,65,64);
 const a=await ctx.SAEF_Archive.open('test.lha',header('game.adf',expected,level,method,packed));
 assert.equal(a.type,'lha');assert.equal(a.entries[0].name,'game.adf');assert.deepEqual(Buffer.from(await a.entries[0].read()),expected);
});
test('LHA images pass through the regular media loader',async()=>{
 const a=header('game.adf',Buffer.from('DOS\0test'));const file={name:'game.lha',arrayBuffer:async()=>Uint8Array.from(a).buffer};
 const media=await ctx.SAEF_Media_load(file,'floppy');assert.equal(media.name,'game.adf');assert.equal(media.data,'DOS\0test');
});
test('LHA corruption and unsupported methods fail clearly',async()=>{
 const good=header('game.adf',Buffer.from('hello'));
 const corruptHeader=Buffer.from(good);corruptHeader[15]^=1;await assert.rejects(ctx.SAEF_Archive.open('x.lha',corruptHeader),/header checksum/);
 const corruptData=Buffer.from(good);corruptData[corruptData.length-2]^=1;const a=await ctx.SAEF_Archive.open('x.lha',corruptData);await assert.rejects(a.entries[0].read(),/CRC mismatch/);
 await assert.rejects(ctx.SAEF_Archive.open('x.lha',good.subarray(0,-3)),/Truncated/);
 await assert.rejects(ctx.SAEF_Archive.open('x.lha',header('../bad',Buffer.from('x'))),/Unsafe/);
 const unsupported=await ctx.SAEF_Archive.open('x.lha',header('x.adf',Buffer.from('abc'),0,'-lh1-'));await assert.rejects(unsupported.entries[0].read(),/Unsupported LHA compression/);
 const truncated=await ctx.SAEF_Archive.open('x.lha',header('x.adf',Buffer.from('abc'),0,'-lh5-',Buffer.from([0,1])));await assert.rejects(truncated.entries[0].read(),/Truncated/);
});
test('supplied Turrican LHA extracts with CRC verification and builds an FFS volume',{skip:!fs.existsSync(gamePath)},async()=>{
 const archive=await ctx.SAEF_Archive.open('Turrican.lha',fs.readFileSync(gamePath));assert.equal(archive.entries.length,18);
 let size=0;for(const e of archive.entries)size+=(await e.read()).length;assert.equal(size,1004266);
 const disk=await ctx.SAEF_WHDLoad.prepare(archive,'Turrican/Turrican.Slave',new Uint8Array([0,0,3,243]));assert.equal(Buffer.from(disk).toString('latin1',0,4),'DOS\1');
});
test('runtime archive selects C/WHDLoad and excludes unrelated programs',async()=>{
 const runtime=new Uint8Array([0,0,3,243]);
 const archive={type:'lha',entries:[{name:'WHDLoad/C/WHDLoad',size:4,read:async()=>runtime},{name:'WHDLoad/C/DIC',size:4,read:async()=>new Uint8Array(4)}]};
 assert.equal(await ctx.SAEF_WHDLoad.runtime(archive),runtime);
});
test('stored LHA entries ending in slash are empty directories',async()=>{
 const archive=await ctx.SAEF_Archive.open('folders.lha',header('Game/save/',Buffer.alloc(0)));
 assert.equal(archive.entries[0].directory,true);
 assert.equal((await archive.entries[0].read()).length,0);
 await assert.rejects(ctx.SAEF_Archive.open('bad.lha',header('Game/save/',Buffer.from([1]))),/directory/);
});
