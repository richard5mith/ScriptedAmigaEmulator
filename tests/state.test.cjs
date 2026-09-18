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
