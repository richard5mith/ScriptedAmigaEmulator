const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context=vm.createContext({Uint8Array,Map,Set,Blob,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,btoa,atob});
vm.runInContext(fs.readFileSync('launcher/saves.js','utf8'),context);const api=context.SAESaves;
class Store {
 constructor(){this.rows=new Map();this.fail=false;}
 async read(key){return structuredClone(this.rows.get(key));}
 async list(gameId){return structuredClone([...this.rows.values()].filter(r=>r.gameId===gameId));}
 async write(record,revision){if(this.fail)throw new Error('Quota exceeded');assert.equal(this.rows.get(record.key)?.revision||0,revision);this.rows.set(record.key,structuredClone(record));}
 async replace(records){for(const row of records)this.rows.set(row.key,structuredClone(row));}
}
const image=()=>({name:'game.hdf',data:new Uint8Array([0,1,2,3])});
test('disk changes restore in a new session without modifying source image',async()=>{
 const store=new Store(),session=new api.Session(store,'game'),source=image(),mounted=await session.mount(source,'hardfile');
 const live=mounted.data.slice();live[2]=99;mounted.onWrite(live,live.length,mounted.name);
 await session.flush();session.close();assert.deepEqual([...source.data],[0,1,2,3]);
 const next=new api.Session(store,'game');assert.deepEqual([...(await next.mount(image(),'hardfile')).data],[0,1,99,3]);next.close();
});
test('games, different disk members and changed source images cannot share saves',async()=>{
 const store=new Store(),s=new api.Session(store,'a'),m=await s.mount(image(),'disk1');m.onWrite(new Uint8Array([9,8,7,6]),4,m.name);await s.flush();s.close();
 for(const [game,medium,source] of [['b','disk1',image()],['a','disk2',image()],['a','disk1',{name:'game.hdf',data:new Uint8Array([4,5,6,7])}]]){const other=new api.Session(store,game);assert.deepEqual([...(await other.mount(source,medium)).data],[...source.data]);other.close();}
});
test('storage failure keeps dirty media available for retry and emergency export',async()=>{
 const store=new Store(),s=new api.Session(store,'game'),m=await s.mount(image(),'disk');m.onWrite(new Uint8Array([8,8,8,8]),4,m.name);store.fail=true;
 await assert.rejects(s.flush(),/Quota/);assert.equal(s.dirty,true);assert.equal((await s.records())[0].data[0],8);
 store.fail=false;await s.flush();assert.equal(s.dirty,false);s.close();
});
test('a write during asynchronous commit is persisted by a subsequent revision',async()=>{
 const store=new Store(),s=new api.Session(store,'game'),m=await s.mount(image(),'disk');
 const write=store.write.bind(store);let once=true;store.write=async(record,revision)=>{if(once){once=false;m.onWrite(new Uint8Array([7,7,7,7]),4,m.name);}await write(record,revision);};
 m.onWrite(new Uint8Array([6,6,6,6]),4,m.name);await s.flush();assert.equal((await store.list('game'))[0].data[0],7);assert.equal(s.dirty,false);s.close();
});
test('media survives ejection, remount and converted disk names',async()=>{
 const store=new Store(),s=new api.Session(store,'game'),m=await s.mount(image(),'disk');m.onWrite(new Uint8Array([5,4,3,2]),4,'converted.adf');
 const next=await s.mount(image(),'disk');assert.equal(next.name,'converted.adf');assert.equal(next.data[0],5);await s.flush();s.close();
});
test('read-only mounts restore saves but do not install write callbacks',async()=>{
 const s=new api.Session(new Store(),'game');const m=await s.mount(image(),'disk',true);assert.equal(m.onWrite,null);assert.equal(s.dirty,false);s.close();
});
test('backup round trip and corrupt backup rejection preserve previous saves',async()=>{
 const store=new Store(),s=new api.Session(store,'game'),m=await s.mount(image(),'disk');m.onWrite(new Uint8Array([2,2,2,2]),4,m.name);await s.flush();s.close();
 const blob=await api.exportFile(await store.list('game'),'Game'),destination=new Store();await api.importFile(blob,'game',destination);
 assert.equal((await destination.list('game'))[0].data[0],2);
 const bad=JSON.parse(await blob.text());bad.media[0].data='AAAAAA==';await assert.rejects(api.importFile(new Blob([JSON.stringify(bad)]),'game',destination),/damaged/);
 assert.equal((await destination.list('game'))[0].data[0],2);
});
test('damaged saved media blocks launch instead of starting with lost progress',async()=>{
 const store=new Store(),s=new api.Session(store,'game'),m=await s.mount(image(),'disk');m.onWrite(new Uint8Array([5,5,5,5]),4,m.name);await s.flush();s.close();
 [...store.rows.values()][0].data[0]=0;const next=new api.Session(store,'game');await assert.rejects(next.mount(image(),'disk'),/damaged/);next.close();
});
test('SAE file writes notify persistence with final bytes, including buffer growth',()=>{
 const c=vm.createContext({Uint8Array,DataView,ArrayBuffer,Int16Array,SAEF_log:()=>{}});
 vm.runInContext(fs.readFileSync('sae/utils.js','utf8'),c);
 let observed;const source=new Uint8Array([0,0,0,0,0,0,0,0]);
 const file={name:'disk.adf',data:source,size:source.length,onWrite:(data,size,name)=>observed={data:data.slice(0,size),size,name}};
 const disk=c.SAEF_ZFile_fopen_file(file);
 c.SAEF_ZFile_fseek(disk,7,0);c.SAEF_ZFile_fwrite(new Uint8Array([7,8,9]),0,1,3,disk);
 assert.equal(observed.size,10);assert.equal(observed.name,'disk.adf');assert.deepEqual([...observed.data.slice(-3)],[7,8,9]);
 assert.equal(source[7],0);c.SAEF_ZFile_fclose(disk);assert.equal(observed.data[9],9);
});
test('checkpoint disks stage without writes and restore their own revisions only after adoption',async()=>{
 const store=new Store(),s=new api.Session(store,'game');let m=await s.mount(image(),'disk');
 m.onWrite(new Uint8Array([1,1,1,1]),4,m.name);await s.flush();const checkpoint=await s.checkpointMedia();
 m.onWrite(new Uint8Array([2,2,2,2]),4,m.name);await s.flush();s.close();
 const next=new api.Session(store,'game');m=await next.mount(image(),'disk',false,checkpoint);
 assert.deepEqual([...m.data],[1,1,1,1]);assert.equal(next.dirty,false);assert.equal((await store.list('game'))[0].data[0],2);
 next.adoptCheckpoint();await next.flush();assert.equal((await store.list('game'))[0].data[0],1);
 m.onWrite(new Uint8Array([3,3,3,3]),4,m.name);await next.flush();assert.equal((await store.list('game'))[0].data[0],3);next.close();
});
test('checkpoint includes untouched mounted disks and rejects changed source media',async()=>{
 const store=new Store(),s=new api.Session(store,'game');await s.mount(image(),'disk');const checkpoint=await s.checkpointMedia();s.close();
 assert.equal(checkpoint.length,1);const next=new api.Session(store,'game');
 await assert.rejects(next.mount({name:'changed',data:new Uint8Array([9,9,9])},'disk',false,checkpoint),/different game files/);next.close();
});
test('checkpoint adoption also restores disks ejected before capture',async()=>{
 const store=new Store(),s=new api.Session(store,'game'),a=await s.mount(image(),'disk1'),b=await s.mount(image(),'disk2');
 a.onWrite(new Uint8Array([1,1,1,1]),4,a.name);b.onWrite(new Uint8Array([2,2,2,2]),4,b.name);await s.flush();const checkpoint=await s.checkpointMedia();
 a.onWrite(new Uint8Array([3,3,3,3]),4,a.name);await s.flush();s.close();
 const next=new api.Session(store,'game');await next.stageCheckpoint(checkpoint);await next.mount(image(),'disk2',false,checkpoint);next.adoptCheckpoint();await next.flush();
 assert.equal((await next.mount(image(),'disk1')).data[0],1);next.close();
});
