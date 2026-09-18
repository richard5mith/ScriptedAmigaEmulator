/* Machine checkpoints. Executable code and browser resources are never serialized. GPL-2.0-or-later. */
var SAEState = (function() {
  'use strict';
  const VERSION=1, LIMIT=256*1024*1024;
  const components=['audio','autoconf','blitter','cia','copper','cpu','custom','devices','disk','dongle','events','expansion','filesys','gayle','hardfile','ide','input','m68k','memory','parallel','playfield','rtc','serial'];
  let registry=null, pending=null;
  function environment(){return {audioRate:SAER.audio._saeState.get().used_freq,videoAPI:SAEV_config.video.api};}
  function roots(){return {environment:environment(),globals:SAEStateGlobals.get(),devices:Object.fromEntries(components.map(k=>[k,SAER[k]]))};}
  function prepare() {
    const functions=new Map(),byName=new Map(),anchors=new Map(),byAnchor=new Map(),externals=new Map(),byExternal=new Map(),seen=new Set();
    function visit(value,path) {
      if(typeof value==='function'){if(!functions.has(value)){functions.set(value,path);byName.set(path,value);}return;}
      if(!value||typeof value!=='object'||seen.has(value)||value instanceof ArrayBuffer||ArrayBuffer.isView(value))return;
      seen.add(value);
      if(value._saeState){anchors.set(value,path);byAnchor.set(path,value);visit(value._saeState.functions(),path+'/functions');visit(value._saeState.get(),path+'/private');}
      for(const key of Object.keys(value))visit(value[key],path+'/'+key);
    }
    // Named local callbacks must have stable identities even if not scheduled yet.
    for(const key of components){const object=SAER[key];if(object._saeState)visit(object._saeState.functions(),'functions/'+key);}
    function constant(value,path){
      if(!value||typeof value!=='object'||externals.has(value))return;
      externals.set(value,path);byExternal.set(path,value);
      for(const key of Object.keys(value))constant(value[key],path+'/'+key);
    }
    for(const key of components){const values=SAER[key]._saeState?.constants?.()||{};for(const name of Object.keys(values))constant(values[name],'constants/'+key+'/'+name);}
    visit(SAEV_config,'config');visit(SAER.video,'video');visit(roots(),'machine');
    registry={functions,byName,anchors,byAnchor,externals,byExternal};refreshMedia();
  }
  function refreshMedia(){
    if(!registry)return;
    function bind(file,name){if(typeof file?.onWrite==='function'){registry.functions.set(file.onWrite,name);registry.byName.set(name,file.onWrite);}}
    SAEV_config.floppy.drive.forEach((drive,i)=>bind(drive.file,'media/floppy/'+i));
    SAEV_config.mount.config.forEach((mount,i)=>bind(mount.ci.file,'media/hardfile/'+i));
  }
  function encode(root,reg) {
    const nodes=[],seen=new Map();let bytes=0;
    function ref(value,path) {
      if(typeof value==='function'){
        const name=reg.functions.get(value);if(!name)throw Error('Unregistered state callback: '+path);
        return {fn:name};
      }
      if(value===null||typeof value!=='object')return value===undefined?{undef:true}:value;
      if(reg.externals?.has(value))return {external:reg.externals.get(value)};
      if(seen.has(value))return {ref:seen.get(value)};
      const id=nodes.length;seen.set(value,id);nodes.push(null);let node;
      if(value instanceof ArrayBuffer){bytes+=value.byteLength;if(bytes>LIMIT)throw Error('Save state exceeds 256 MiB.');node={type:'buffer',data:value.slice(0)};}
      else if(ArrayBuffer.isView(value))node={type:'view',kind:value.constructor.name,buffer:ref(value.buffer,path+'/buffer'),offset:value.byteOffset,length:value instanceof DataView?value.byteLength:value.length};
      else{
        const proto=Object.getPrototypeOf(value);
        if(!Array.isArray(value)&&proto&&proto!==Object.prototype&&Object.prototype.toString.call(value)!=='[object Object]')throw Error('Unsupported state object: '+path+' ('+value.constructor?.name+')');
        const keys=Object.keys(value);
        if(!value._saeState&&(!Array.isArray(value)||keys.length===value.length)&&keys.every(k=>value[k]===null||['number','string','boolean','undefined'].includes(typeof value[k]))){
          node={type:Array.isArray(value)?'values':'record',data:Array.isArray(value)?value.slice():Object.assign({},value)};
          nodes[id]=node;return {ref:id};
        }
        node={type:Array.isArray(value)?'array':'object',length:Array.isArray(value)?value.length:undefined,props:[]};
        if(value._saeState){node.anchor=reg.anchors.get(value);if(!node.anchor)throw Error('Unregistered state device: '+path);node.private=ref(value._saeState.get(),path+'/private');}
        for(const key of Object.keys(value))node.props.push([key,ref(value[key],path+'/'+key)]);
      }
      nodes[id]=node;return {ref:id};
    }
    return {version:VERSION,root:ref(root,'machine'),nodes};
  }
  function decode(snapshot,reg) {
    if(snapshot?.version!==VERSION||!Array.isArray(snapshot.nodes)||snapshot.nodes.length>2000000)throw Error('This save state is incompatible.');
    const nodes=snapshot.nodes,objects=new Array(nodes.length),updates=[];let bytes=0;
    const types={Uint8Array,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,Uint8ClampedArray,DataView};
    function deref(r){if(r===null||typeof r!=='object')return r;if(r.undef===true)return undefined;if('external'in r){if(!reg.byExternal?.has(r.external))throw Error('Missing state constant: '+r.external);return reg.byExternal.get(r.external);}if('fn'in r){if(!reg.byName.has(r.fn))throw Error('Missing state callback: '+r.fn);return reg.byName.get(r.fn);}if(!Number.isInteger(r.ref)||r.ref<0||r.ref>=nodes.length)throw Error('Invalid state reference.');return materialize(r.ref);}
    function materialize(i){
      if(objects[i]!==undefined)return objects[i];const n=nodes[i];let o;
      if(n.type==='record'||n.type==='values'){if(!n.data||typeof n.data!=='object')throw Error('Invalid state values.');o=Array.isArray(n.data)?n.data.slice():{...n.data};}
      else if(n.type==='buffer'){if(!(n.data instanceof ArrayBuffer)||(bytes+=n.data.byteLength)>LIMIT)throw Error('Invalid state buffer.');o=n.data.slice(0);}
      else if(n.type==='view'){const C=types[n.kind];if(!C)throw Error('Invalid state array.');o=new C(deref(n.buffer),n.offset,n.length);}
      else if(n.type==='object'||n.type==='array'){
        if(n.anchor){o=reg.byAnchor.get(n.anchor);if(!o)throw Error('Missing state device: '+n.anchor);}
        else o=n.type==='array'?new Array(n.length):{};
        objects[i]=o;
        const props=[];if(!Array.isArray(n.props))throw Error('Invalid state object.');
        for(const [key,r]of n.props){if(['__proto__','prototype','constructor'].includes(key))throw Error('Invalid state property.');props.push([key,deref(r)]);}
        const privateState=n.private?deref(n.private):null;
        if(n.anchor){
          const expected=Object.keys(o._saeState.get());
          if(!privateState||expected.length!==Object.keys(privateState).length||expected.some(k=>!Object.hasOwn(privateState,k)))throw Error('Incomplete device state: '+n.anchor);
        }
        if(n.anchor)updates.push(()=>{for(const [k,v]of props)o[k]=v;if(privateState)o._saeState.set(privateState);});
        else for(const [k,v]of props)o[k]=v;
      }else throw Error('Invalid state node.');
      objects[i]=o;return o;
    }
    const result=deref(snapshot.root);
    return {result,commit(){for(const update of updates)update();}};
  }
  function capture(){if(!SAER.running||!SAER.paused||!registry)throw Error('Pause the game before saving its state.');refreshMedia();return encode(roots(),registry);}
  function restore(snapshot){
    const decoded=decode(snapshot,registry);
    if(!decoded.result?.globals||!decoded.result?.devices)throw Error('Incomplete machine state.');
    if(JSON.stringify(decoded.result.environment)!==JSON.stringify(environment()))throw Error('This saved position uses different audio or display hardware settings.');
    const keys=Object.keys(SAEStateGlobals.get());
    if(keys.length!==Object.keys(decoded.result.globals).length||keys.some(k=>!Object.hasOwn(decoded.result.globals,k))||components.some(k=>decoded.result.devices[k]!==SAER[k]))throw Error('Incomplete machine state.');
    decoded.commit();SAEStateGlobals.set(decoded.result.globals);
    SAEV_command=0;SAEV_spcflags&=~SAEC_spcflag_MODE_CHANGE;
    SAER.events.reset_frame_rate_hack();
  }
  // Called after device reset, before the first guest instruction.
  function boot(){prepare();if(pending){const task=pending;pending=null;try{restore(task.snapshot);task.done();}catch(error){task.failed(error);return false;}}return true;}
  function queue(snapshot,done,failed){pending={snapshot,done,failed};}
  function cancel(){pending=null;}
  function begin(){registry=null;}
  return {get ready(){return !!registry;},begin,VERSION,capture,restore,boot,queue,cancel,encode,decode};
})();
if(typeof module!=='undefined')module.exports=SAEState;
