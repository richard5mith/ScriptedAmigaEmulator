const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx=vm.createContext({Uint8Array,DataView,Blob,DecompressionStream,TextDecoder});
for(const name of ['sae/lha.js','sae/archive.js','launcher/library.js','launcher/system.js'])vm.runInContext(fs.readFileSync(name,'utf8'),ctx);
const lib=ctx.SAELibrary,system=ctx.SAESystem;
const file=path=>({path,name:path.split('/').pop(),size:1,read:async()=>new Uint8Array([1])});
const rom=(name,info)=>({name,path:'bios/'+name,info});
const old=rom('kick13.rom',null),modern=rom('kick31.rom',{ver:3,rev:1,subVer:40,subRev:63,models:'A500, A600, A2000'});
test('A1200 chooses internal Kickstart 40, not release number 3',()=>{
 assert.equal(lib.chooseRom([old,modern],'A1200','auto'),modern);
 assert.equal(lib.chooseRom([modern,old],'A1200','auto'),modern);
});
test('A1200 does not silently fall back to Kickstart 1.3',()=>assert.equal(lib.chooseRom([old],'A1200','auto'),undefined));
test('A1200 prefers its matching ROM when available',()=>{
 const matching=rom('unknown-name.rom',{ver:3,subVer:40,models:'A1200'});
 assert.equal(lib.chooseRom([old,modern,matching],'A1200','auto'),matching);
});
test('A500 defaults to 1.3 even when newer A500-compatible ROM exists',()=>assert.equal(lib.chooseRom([modern,old],'A500','auto'),old));
test('explicit ROM choice is respected, missing selection does not fall back',()=>{
 assert.equal(lib.chooseRom([old,modern],'A1200',old.path),old);
 assert.equal(lib.chooseRom([old,modern],'A1200','missing.rom'),undefined);
});
test('WHDLoad support ROM names use internal version and revision',()=>{
 assert.equal(system.kickName(modern.info),'kick40063.A600');
 assert.equal(system.kickName({ver:1,rev:3,subVer:34,subRev:5,models:'A500'}),'kick34005.A500');
 assert.equal(system.kickName({ver:3,rev:1,subVer:40,subRev:68,models:'A1200'}),'kick40068.A1200');
});
test('one library groups archives, disk sets and extracted WHDLoad games',async()=>{
 const result=lib.group(['games/Qwak.zip','games/R-Type.lha','games/Example Disk 2.adf','games/Example Disk 1.adf','games/Installed/Game.slave','games/Installed/data/file','bios/kick31.rom','bios/WHDLoad_usr.lha','.hidden/ignore.zip'].map(file));
 assert.equal(result.games.length,4);assert.equal(result.system.length,2);
 const disks=result.games.find(g=>g.kind==='disks');assert.equal(disks.files[0].name,'Example Disk 1.adf');
 assert.equal((await lib.inspect(disks)).type,'floppy');
 const installed=await lib.inspect(result.games.find(g=>g.kind==='folder'));
 assert.equal(installed.type,'whdload');assert.equal(installed.variants[0].name,'Game.slave');assert.equal(installed.archive.entries.length,2);
});
test('folder paths normalize independent of chosen parent folder',()=>{
 assert.equal(lib.normalize('Collection/games/Qwak.zip'),'games/Qwak.zip');
 assert.equal(lib.normalize('Collection/bios/kick31.rom'),'bios/kick31.rom');
});
test('default machine is A1200 with automatic system file selection',()=>{
 assert.equal(system.defaults.model,'A1200');assert.equal(system.defaults.rom,'auto');assert.equal(system.defaults.runtime,'auto');
});
test('mirrored 256 KB ROM dump is identified and included under WHDLoad name',async()=>{
 ctx.SAEO_RomInfo=function(){};ctx.SAEE_None=0;
 const data=new Uint8Array(512*1024);data[0]=data[256*1024]=1;
 const emulator={getRomInfo(info,f){if(f.size!==256*1024)return 1;Object.assign(info,{ver:1,rev:3,subVer:34,subRev:5,models:'A500'});return 0;}};
 const result=await system.scan([{path:'bios/test.rom',name:'test.rom',size:data.length,read:async()=>data}],emulator);
 assert.equal(result.roms[0].info.subVer,34);assert.equal(result.roms[0].data.length,256*1024);
 assert.equal(result.support.entries[0].name,'Devs/Kickstarts/kick34005.A500');
});
