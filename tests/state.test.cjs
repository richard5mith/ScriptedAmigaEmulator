const {test}=require('node:test'),assert=require('node:assert/strict');
const codec=require('../sae/state.js'),file=require('../launcher/checkpoints.js');
function registry(){return {functions:new Map(),byName:new Map(),anchors:new Map(),byAnchor:new Map()};}
test('state codec preserves cycles, memory aliases, offsets and special numbers across compression',async()=>{
 const reg=registry(),buffer=new ArrayBuffer(32),a=new Uint8Array(buffer,4,12),b=new Uint16Array(buffer,8,3);
 a[4]=37;const holes=new Array(4);holes[2]=undefined;
 const root={a,b,again:a,view:new DataView(buffer,2,8),nil:null,empty:undefined,holes,values:[undefined,NaN,Infinity,-Infinity,-0,null],record:{empty:undefined,zero:-0}};root.self=root;
 const encoded=codec.encode(root,reg),packed=await file.pack(encoded),decoded=codec.decode(await file.unpack(packed),reg).result;
 assert.equal(decoded.self,decoded);assert.equal(decoded.a,decoded.again);assert.equal(decoded.a.buffer,decoded.b.buffer);assert.equal(decoded.view.buffer,decoded.a.buffer);
 assert.equal(decoded.a.byteOffset,4);assert.equal(decoded.b.byteOffset,8);assert.equal(decoded.b[0],37);assert.deepEqual(decoded.values,root.values);assert.deepEqual(decoded.holes,holes);assert.deepEqual(decoded.record,root.record);
 decoded.b[0]=12;assert.equal(decoded.a[4],12);assert.equal(a[4],37,'decoded memory is independent of source');
});
test('closure-backed devices keep fresh live instances and registered code',()=>{
 function device(initial){let value=initial;return {read(){return value;},_saeState:{get:()=>({value}),set:s=>value=s.value}};}
 const old=device(42),fresh=device(0),before=registry(),after=registry();
 // _saeState is non-enumerable in the real generated accessors.
 for(const x of [old,fresh])Object.defineProperty(x,'_saeState',{enumerable:false});
 before.anchors.set(old,'cpu');before.functions.set(old.read,'read');after.byAnchor.set('cpu',fresh);after.byName.set('read',fresh.read);
 const stored=codec.encode({device:old,alias:old},before),decoded=codec.decode(stored,after);
 assert.equal(fresh.read(),0,'validation does not mutate the running device');decoded.commit();
 assert.equal(decoded.result.device,fresh);assert.equal(decoded.result.alias,fresh);assert.equal(fresh.read(),42);
});
test('unknown callbacks and incomplete device state fail without partial application',()=>{
 assert.throws(()=>codec.encode({handler(){ }},registry()),/Unregistered state callback/);
 let value=1;const device={};Object.defineProperty(device,'_saeState',{value:{get:()=>({value}),set:s=>value=s.value}});
 const reg=registry();reg.anchors.set(device,'device');reg.byAnchor.set('device',device);
 const stored=codec.encode(device,reg),priv=stored.nodes[stored.nodes[stored.root.ref].private.ref];priv.data={};
 assert.throws(()=>codec.decode(stored,reg),/Incomplete device state/);assert.equal(value,1);
 const functions=registry(),f=()=>{};functions.functions.set(f,'missing');const invalid=codec.encode({handler:f},functions);
 assert.throws(()=>codec.decode(invalid,registry()),/Missing state callback/);
});
test('damaged compressed snapshots fail checksum verification',async()=>{
 const packed=await file.pack(codec.encode({value:7},registry()));const bytes=new Uint8Array(await packed.data.arrayBuffer());bytes[bytes.length-1]^=1;
 await assert.rejects(file.unpack({...packed,data:new Blob([bytes])}),/damaged/);
});
test('immutable hardware lookup-table pointers resolve to the fresh core table',()=>{
 const old=[1,2,3],fresh=[1,2,3],before=registry(),after=registry();before.externals=new Map([[old,'diagram']]);after.byExternal=new Map([['diagram',fresh]]);
 const result=codec.decode(codec.encode({selected:old},before),after).result;assert.equal(result.selected,fresh);
});
test('legacy event pacing fields migrate without relaxing guest-device validation',()=>{
 let state={nextevent:10,eventtab:[{time:42}]};const device={};
 Object.defineProperty(device,'_saeState',{value:{get:()=>state,set:s=>state=s}});
 const reg=registry();reg.anchors.set(device,'machine/devices/events');reg.byAnchor.set('machine/devices/events',device);
 const stored=codec.encode(device,reg),priv=stored.nodes[stored.nodes[stored.root.ref].private.ref];
 priv.props.push(['is_syncline',2],['is_syncline_end',987654321]);
 const decoded=codec.decode(stored,reg);assert.equal(state.nextevent,10);decoded.commit();
 assert.deepEqual(Object.keys(state),['nextevent','eventtab']);assert.equal(state.eventtab[0].time,42);
 assert.ok(priv.props.some(([key])=>key==='is_syncline'),'migration leaves the stored snapshot intact');
 priv.props.push(['unknown_guest_field',1]);
 assert.throws(()=>codec.decode(stored,reg),/unexpected: unknown_guest_field/);
 priv.props=priv.props.filter(([key])=>!['unknown_guest_field','eventtab'].includes(key));
 assert.throws(()=>codec.decode(stored,reg),/missing: eventtab/);
 const other=codec.encode(device,reg);other.nodes[other.root.ref].anchor='other';reg.byAnchor.set('other',device);
 other.nodes[other.nodes[other.root.ref].private.ref].props.push(['is_syncline',2]);
 assert.throws(()=>codec.decode(other,reg),/unexpected: is_syncline/);
});
test('checkpoint callback aliases resolve when a drawing pointer precedes its array slot on relaunch',()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const names=['audio','autoconf','blitter','cia','copper','cpu','custom','devices','disk','dongle','events','expansion','filesys','gayle','hardfile','ide','input','m68k','memory','parallel','playfield','rtc','serial'];
 function machine(aliasFirst){
  const row={value:42,clr(){this.value=0;}},state={dp_for_drawing:aliasFirst?row:null,line_decisions:[row]};
  const devices=Object.fromEntries(names.map(name=>[name,{_saeState:{get:()=>({}),set(){},functions:()=>({})}}]));
  devices.audio._saeState={get:()=>({used_freq:48000}),set(){}};
  devices.playfield._saeState={get:()=>state,set:s=>Object.assign(state,s),functions:()=>({})};
  devices.events.reset_frame_rate_hack=()=>{};
  // The audio stub needs the same accessor interface as every real device.
  devices.audio._saeState.functions=()=>({});
  for(const device of Object.values(devices))Object.defineProperty(device,'_saeState',{enumerable:false});
  return {devices,state,row};
 }
 const old=machine(false),ctx=vm.createContext({
  SAER:{...old.devices,video:{},running:true,paused:true},
  SAEV_config:{audio:{channels:2},video:{api:0},floppy:{drive:[]},mount:{config:[]}},
  SAEStateGlobals:{get:()=>({}),set(){}},SAEV_command:0,SAEV_spcflags:0,SAEC_spcflag_MODE_CHANGE:1
 });
 vm.runInContext(fs.readFileSync('sae/state.js','utf8'),ctx);
 assert.equal(ctx.SAEState.boot(),true);old.state.dp_for_drawing=old.row;
 const snapshot=ctx.SAEState.capture(),fresh=machine(true);
 Object.assign(ctx.SAER,fresh.devices);let restored=false;
 ctx.SAEState.queue(snapshot,()=>{restored=true;},error=>{throw error;});
 assert.equal(ctx.SAEState.boot(),true);assert.equal(restored,true);
 assert.equal(fresh.state.dp_for_drawing,fresh.state.line_decisions[0]);
 fresh.state.line_decisions[0].clr();assert.equal(fresh.state.line_decisions[0].value,0);
 const second=ctx.SAEState.capture(),reloaded=machine(false);
 Object.assign(ctx.SAER,reloaded.devices);ctx.SAEState.queue(second,()=>{},error=>{throw error;});
 assert.equal(ctx.SAEState.boot(),true);assert.equal(reloaded.state.line_decisions[0].value,0);
});
