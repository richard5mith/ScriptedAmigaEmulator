const gamePath = require('node:fs').existsSync('games/Qwak.zip') ? 'games/Qwak.zip' : 'Qwak.zip';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');
const context = vm.createContext({Uint8Array, DataView, Blob, DecompressionStream, TextDecoder,
 SAEF_String2Array:s=>Uint8Array.from(s,c=>c.charCodeAt(0)),
 SAEF_Array2String:a=>Buffer.from(a).toString('latin1'), prompt:()=> '2'});
vm.runInContext(fs.readFileSync('sae/lha.js','utf8'), context);
vm.runInContext(fs.readFileSync('sae/archive.js','utf8'), context);
vm.runInContext(fs.readFileSync('sae/media.js','utf8'), context);
const api = context.SAEF_Archive;
function zip(files, method=8) {
 let parts=[], directory=[], offset=0;
 for (const [filename,input] of files) {
  const name=Buffer.from(filename), data=Buffer.from(input), packed=method===8?zlib.deflateRawSync(data):data;
  const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method,8);
  local.writeUInt32LE(api.crc32(data),14); local.writeUInt32LE(packed.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method,10);
  central.writeUInt32LE(api.crc32(data),16); central.writeUInt32LE(packed.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(name.length,28); central.writeUInt32LE(offset,42);
  parts.push(local,name,packed); directory.push(central,name); offset+=30+name.length+packed.length;
 }
 const dir=Buffer.concat(directory), end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(dir.length,12); end.writeUInt32LE(offset,16);
 return Buffer.concat([...parts,dir,end]);
}
const blob=(name,data)=>({name,arrayBuffer:async()=>Uint8Array.from(data).buffer});
for(const method of [0,8]) test('ZIP method '+method+' round trip', async()=>{
 const input=Buffer.from('Amiga data '.repeat(10000));
 const archive=await api.open('game.zip',zip([['game.adf',input]],method));
 assert.deepEqual(Buffer.from(await archive.entries[0].read()),input);
});
test('gzip ADZ and HDZ are renamed and expanded',async()=>{
 for(const [name,expected,kind] of [['game.adz','game.adf','floppy'],['system.hdz','system.hdf','hardfile']]) {
  const media=await context.SAEF_Media_load(blob(name,zlib.gzipSync('DOS\0example')),kind);
  assert.equal(media.name,expected); assert.equal(media.data,'DOS\0example'); assert.equal(media.size,11);
 }
});
test('multi-disk ZIP selection preserves selected name and size',async()=>{
 const media=await context.SAEF_Media_load(blob('game.zip',zip([['readme.txt','ignored'],['disk1.adf','first'],['disk2.adf','second']])),'floppy');
 assert.equal(media.name,'disk2.adf'); assert.equal(media.data,'second'); assert.equal(media.size,6);
});
test('nested ADZ in ZIP',async()=>{
 const media=await context.SAEF_Media_load(blob('game.zip',zip([['disk.adz',zlib.gzipSync('hello')]])),'floppy');
 assert.equal(media.name,'disk.adf'); assert.equal(media.data,'hello');
});
test('plain images remain usable',async()=>{
 const media=await context.SAEF_Media_load(blob('Disk.1',Buffer.from('disk data')),'floppy');
 assert.equal(media.data,'disk data'); assert.equal(media.name,'Disk.1');
});
test('bad checksum rejects selected ZIP entry',async()=>{
 const data=zip([['disk.adf','abc']],0); data[38]^=1;
 const archive=await api.open('x.zip',data);
 await assert.rejects(archive.entries[0].read(),/checksum/);
});
test('truncation, encryption, ZIP64 and traversal fail clearly',async()=>{
 const data=zip([['disk.adf','data']]);
 await assert.rejects(api.open('x.zip',data.subarray(0,-1)),/truncated/);
 const encrypted=Buffer.from(data); encrypted.writeUInt16LE(1,encrypted.indexOf(Buffer.from('504b0102','hex'))+8);
 await assert.rejects(api.open('x.zip',encrypted),/Encrypted/);
 const zip64=Buffer.from(data); zip64.writeUInt16LE(65535,zip64.length-22+8); zip64.writeUInt16LE(65535,zip64.length-22+10);
 await assert.rejects(api.open('x.zip',zip64),/ZIP64/);
 await assert.rejects(api.open('x.zip',zip([['../disk.adf','x']])),/Unsafe/);
});
test('invalid gzip checksum is rejected',async()=>{
 const data=zlib.gzipSync('hello'); data[data.length-8]^=1;
 await assert.rejects(api.open('bad.adz',data));
});
test('WHDLoad archives are distinguished from floppy images',async()=>{
 await assert.rejects(context.SAEF_Media_load(blob('game.zip',zip([['Game/Game.Slave','slave'],['Game/Disk.1','disk']])),'floppy'),/WHDLoad/);
});
test('supplied Qwak archive extracts all files', {skip:!fs.existsSync(gamePath)},async()=>{
 const archive=await api.open('Qwak.zip',fs.readFileSync(gamePath));
 let size=0; for(const entry of archive.entries) size+=(await entry.read()).length;
 assert.equal(size,933507); assert.ok(archive.entries.some(e=>e.name==='Qwak/Qwak.Slave'));
});
