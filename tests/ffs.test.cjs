const gamePath = require('node:fs').existsSync('games/Qwak.zip') ? 'games/Qwak.zip' : 'Qwak.zip';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm');
const ctx=vm.createContext({Uint8Array,DataView,Blob,DecompressionStream,TextDecoder,
 SAEF_String2Array:s=>Uint8Array.from(s,c=>c.charCodeAt(0)),SAEF_Array2String:a=>Buffer.from(a).toString('latin1')});
for(const name of ['lha','archive','ffs','whdload']) vm.runInContext(fs.readFileSync('sae/'+name+'.js','utf8'),ctx);
// Read the standard disk structure independently of the writer's allocator.
function readVolume(data) {
 const disk=Buffer.from(data), count=disk.length/512, root=count/2, files=new Map(), used=new Set([0,1]);
 const word=(b,w)=>disk.readUInt32BE(b*512+w*4);
 function meta(b,type) {
  assert.ok(b>1&&b<count); assert.ok(!used.has(b),'duplicate block '+b); used.add(b);
  assert.equal(word(b,0),type);
  let sum=0; for(let w=0;w<128;w++) sum=(sum+word(b,w))>>>0; assert.equal(sum,0,'metadata checksum');
 }
 function directory(block,prefix) {
  meta(block,2);
  for(let slot=6;slot<78;slot++) {
   let child=word(block,slot);
   while(child) {
    const base=child*512, name=disk.toString('latin1',base+433,base+433+disk[base+432]);
    assert.equal(word(child,125),block);
    let hash=name.length; for(const c of name.replace(/[a-z]/g,c=>c.toUpperCase())) hash=(hash*13+c.charCodeAt(0))&2047;
    assert.equal(hash%72,slot-6);
    if(word(child,127)===2) directory(child,prefix+name+'/');
    else {
     meta(child,2); assert.equal(word(child,127),0xfffffffd);
     const size=word(child,81), content=[]; let header=child;
     if(size) assert.equal(word(child,4),word(child,77));
     do {
      for(let i=0;i<word(header,2);i++) {
       const b=word(header,77-i); assert.ok(b>1&&b<count); assert.ok(!used.has(b)); used.add(b); content.push(disk.subarray(b*512,(b+1)*512));
      }
      header=word(header,126);
      if(header) {meta(header,16);assert.equal(word(header,125),child);}
     } while(header);
     files.set(prefix+name,Buffer.concat(content).subarray(0,size));
    }
    child=word(child,124);
   }
  }
 }
 assert.equal(word(0,0),0x444f5301); directory(root,'');
 assert.equal(word(root,78),0xffffffff);
 const maps=[]; for(let i=0;i<Math.ceil((count-2)/4064);i++) {
  const b=word(root,79+i);assert.ok(!used.has(b));used.add(b);maps.push(b);
  let sum=0;for(let w=0;w<128;w++)sum=(sum+word(b,w))>>>0;assert.equal(sum,0);
 }
 for(let b=2;b<count;b++) {
  const bit=b-2, free=(word(maps[Math.floor(bit/4064)],1+Math.floor(bit%4064/32))>>>(bit%32))&1;
  assert.equal(free,used.has(b)?0:1,'bitmap for '+b);
 }
 return files;
}
test('FFS files survive directory hashing, extensions, zero size and bitmap allocation',()=>{
 const large=Uint8Array.from({length:512*150+37},(_,i)=>i%251);
 const input=[{name:'Game/data',data:large},{name:'Game/empty',data:new Uint8Array()},{name:'Docs/ReadMe',data:new Uint8Array([1,2,3])}];
 const files=readVolume(ctx.SAEF_FFS_create(input,'Games'));
 for(const entry of input)assert.deepEqual(files.get(entry.name),Buffer.from(entry.data));
});
test('FFS rejects ambiguous paths and oversized names',()=>{
 for(const name of ['../bad','x'.repeat(31),'Dev:bad','Game/😀']) assert.throws(()=>ctx.SAEF_FFS_create([{name,data:new Uint8Array()}],'Games'),/filename/);
 assert.throws(()=>ctx.SAEF_FFS_create([{name:'Game/a',data:new Uint8Array()},{name:'game/A',data:new Uint8Array()}],'Games'),/Conflicting/);
});
test('WHDLoad validates runtime and generates quoted startup script',async()=>{
 const name='Qwak/Qwak.Slave', archive={entries:[{name,size:4,directory:false,read:async()=>new Uint8Array([1,2,3,4])}]};
 await assert.rejects(ctx.SAEF_WHDLoad.prepare(archive,name,new Uint8Array([80,75,3,4])),/executable/);
 await assert.rejects(ctx.SAEF_WHDLoad.prepare(archive,'missing',new Uint8Array([0,0,3,243])),/slave/);
 const result=await ctx.SAEF_WHDLoad.prepare(archive,name,new Uint8Array([0,0,3,243]));
 const files=readVolume(result);
 assert.equal(files.get('S/Startup-Sequence').toString(),'Stack 16384\nCD "SYS:Games/Qwak"\nSYS:C/WHDLoad "Qwak.Slave" PRELOAD NoMMU\n');
 assert.deepEqual(files.get('Games/'+name),Buffer.from([1,2,3,4]));
});
test('Qwak ZIP becomes a complete WHDLoad filesystem', {skip:!fs.existsSync(gamePath)},async()=>{
 const archive=await ctx.SAEF_Archive.open('Qwak.zip',fs.readFileSync(gamePath));
 const files=readVolume(await ctx.SAEF_WHDLoad.prepare(archive,'Qwak/Qwak.Slave',new Uint8Array([0,0,3,243])));
 for(const entry of archive.entries) if(!entry.directory) assert.deepEqual(files.get('Games/'+entry.name),Buffer.from(await entry.read()));
});
test('long WHDLoad slave aliases avoid case-insensitive collisions and preserve game data',async()=>{
 const long='SensibleWorldOfSoccer9798.Slave';
 const names=['Soccer/'+long,'Soccer/launch1.slave','Soccer/Launch2.Slave','Soccer/'+('X'.repeat(31))+'.Slave','Soccer/Data/TEAM.001','Soccer/Launch3.Slave/data'];
 const archive={entries:names.map((name,i)=>({name,size:1,directory:false,read:async()=>new Uint8Array([i])}))};
 const files=readVolume(await ctx.SAEF_WHDLoad.prepare(archive,names[0],new Uint8Array([0,0,3,243])));
 assert.equal(files.get('Games/Soccer/Launch4.Slave')[0],0);
 assert.equal(files.get('Games/Soccer/launch1.slave')[0],1);
 assert.equal(files.get('Games/Soccer/Launch2.Slave')[0],2);
 assert.equal(files.get('Games/Soccer/Launch5.Slave')[0],3);
 assert.equal(files.get('Games/Soccer/Data/TEAM.001')[0],4);
 assert.match(files.get('S/Startup-Sequence').toString(),/CD "SYS:Games\/Soccer"\nSYS:C\/WHDLoad "Launch4.Slave"/);
 assert.equal(archive.entries[0].name,names[0]);
});
const soccerPath='games/Sensible World Of Soccer 97-98.lha';
test('Sensible World of Soccer 97-98 archive builds a boot volume',{skip:!fs.existsSync(soccerPath)},async()=>{
 const archive=await ctx.SAEF_Archive.open(soccerPath,fs.readFileSync(soccerPath));
 const slave=archive.entries.find(e=>/\.slave$/i.test(e.name));
 const files=readVolume(await ctx.SAEF_WHDLoad.prepare(archive,slave.name,new Uint8Array([0,0,3,243])));
 const script=files.get('S/Startup-Sequence').toString();
 const folder=slave.name.slice(0,slave.name.lastIndexOf('/'));
 assert.match(script,/WHDLoad "Launch1.Slave" PRELOAD NoMMU/);
 assert.deepEqual(files.get('Games/'+folder+'/Launch1.Slave'),Buffer.from(await slave.read()));
 const byName=new Map([...files].map(([name,data])=>[name.toUpperCase(),data]));
 for(const entry of archive.entries)if(!entry.directory&&entry!==slave&&!/^__MACOSX\//.test(entry.name))assert.deepEqual(byName.get(('Games/'+entry.name).toUpperCase()),Buffer.from(await entry.read()),entry.name);
});
