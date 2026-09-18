/* Prepare a self-contained WHDLoad boot partition. GPL-2.0-or-later. */
var SAEF_WHDLoad = (function() {
 "use strict";
 function quote(value) {return '"'+value.replace(/\*/g,'**').replace(/"/g,'*"')+'"';}
 // This small, relocation-free HUNK executable corresponds to native/FlushSaves.s.
 // Emit symbolic PC-relative fixups so changes cannot leave stale branch offsets.
 function flushProgram() {
  var bytes=[], labels={}, fixups=[];
  function word(value){bytes.push((value>>>8)&255,value&255);}
  function op(){for(var value of arguments)word(value);}
  function relative(opcode,label){word(opcode);fixups.push({at:bytes.length,label:label});word(0);}
  op(0x48e7,0x3f3e,0x2c78,4); // preserve registers; ExecBase
  relative(0x43fa,'dosname');op(0x7025,0x4eae,0xfdd8,0x4a80);
  relative(0x6700,'failed');op(0x2c40);
  relative(0x41fa,'device');op(0x2208,0x4eae,0xff52,0x2200);
  relative(0x6700,'delay');op(0x741b,0x7600,0x7800,0x7a00,0x7c00,0x7e00,0x4eae,0xff10,0x4a80);
  relative(0x6600,'close');
  labels.delay=bytes.length;op(0x223c,0,150,0x4eae,0xff3a);
  labels.close=bytes.length;op(0x224e,0x2c78,4,0x4eae,0xfe62,0x7000);
  relative(0x6000,'done');labels.failed=bytes.length;op(0x7014);
  labels.done=bytes.length;op(0x4cdf,0x7cfc,0x4e75);
  labels.dosname=bytes.length;for(var c of 'dos.library\0')bytes.push(c.charCodeAt(0));
  labels.device=bytes.length;for(var c of 'DH0:\0')bytes.push(c.charCodeAt(0));
  while(bytes.length%4)bytes.push(0);
  for(var fixup of fixups){var delta=labels[fixup.label]-fixup.at;bytes[fixup.at]=(delta>>>8)&255;bytes[fixup.at+1]=delta&255;}
  var code=new Uint8Array(bytes), result=new Uint8Array(code.length+36), view=new DataView(result.buffer);
  [0x3f3,0,1,0,0,code.length/4,0x3e9,code.length/4].forEach(function(value,i){view.setUint32(i*4,value);});
  result.set(code,32);view.setUint32(32+code.length,0x3f2);return result;
 }
 async function runtime(archive) {
  var entries=archive.entries.filter(function(e) {return !e.directory && (archive.type==='plain' || archive.type==='gzip' || /(^|\/)C\/WHDLoad$/i.test(e.name) || /^WHDLoad$/i.test(e.name));});
  if(entries.length!==1) throw new Error('Select the official WHDLoad runtime archive or its C/WHDLoad executable.');
  if(entries[0].size>4*1024*1024) throw new Error('WHDLoad executable exceeds the 4 MiB limit.');
  return entries[0].read();
 }
 async function prepare(archive, slave, runtime, support) {
  var chosen=archive.entries.find(function(e) {return e.name===slave && !e.directory && /\.slave$/i.test(e.name);});
  if(!chosen) throw new Error('Select a WHDLoad slave from the game archive.');
  if(runtime.length<4 || runtime.length>4*1024*1024 || runtime[0]!==0 || runtime[1]!==0 || runtime[2]!==3 || runtime[3]!==0xf3)
   throw new Error('The WHDLoad runtime must contain a valid Amiga executable (C/WHDLoad).');
  // Classic FFS limits each name to 30 bytes. The slave is selected explicitly
  // by our startup script, so it can be aliased without renaming game data that
  // the slave may reference internally. Reserve every original path first.
  var aliases=new Map(), reserved=new Set();
  archive.entries.forEach(function(entry) {
   var parts=entry.name.replace(/\/$/,'').split('/');
   for(var i=1;i<=parts.length;i++) reserved.add(parts.slice(0,i).join('/').toUpperCase());
  });
  for(var entry of archive.entries) {
   var slash=entry.name.lastIndexOf('/'), leaf=entry.name.slice(slash+1);
   if(entry.directory || !/\.slave$/i.test(leaf) || leaf.length<=30) continue;
   var prefix=entry.name.slice(0,slash+1), number=1, alias;
   do {alias=prefix+'Launch'+(number++)+'.Slave';} while(reserved.has(alias.toUpperCase()));
   reserved.add(alias.toUpperCase());aliases.set(entry.name,alias);
  }
  var files=[], total=0;
  for(var entry of archive.entries) {
   if(/^__MACOSX\//.test(entry.name)) continue;
   total+=entry.size;
   if(total>40*1024*1024) throw new Error('Game installation exceeds the 40 MiB import limit.');
   files.push({name:'Games/'+(aliases.get(entry.name)||entry.name),directory:entry.directory,data:entry.directory?undefined:await entry.read()});
  }
  files.push({name:'C/WHDLoad',data:runtime});
  files.push({name:'C/FlushSaves',data:flushProgram()});
  // Boot from ROM's DOS shell: Stack and CD are resident commands in Kickstart 3.1.
  slave=aliases.get(slave)||slave;
  var index=slave.lastIndexOf('/'), directory=index<0?'':slave.slice(0,index), filename=slave.slice(index+1);
  var startup='Stack 16384\nCD '+quote('SYS:Games'+(directory?'/'+directory:''))+'\nSYS:C/WHDLoad '+quote(filename)+' PRELOAD NoMMU NoWriteCache WriteDelay=0 ExecutePostDisk=SYS:C/FlushSaves\n';
  files.push({name:'S/Startup-Sequence',data:SAEF_String2Array(startup)});
  if(support) for(var entry of support.entries) {
   // Optional kickemu dependencies retain their Devs/Kickstarts/... layout.
   if(!/^Devs\/Kickstarts\//i.test(entry.name)) continue;
   total+=entry.size;
   if(total>40*1024*1024) throw new Error('Installation and support files exceed the 40 MiB import limit.');
   files.push({name:entry.name,directory:entry.directory,data:entry.directory?undefined:await entry.read()});
  }
  return SAEF_FFS_create(files,'WHDGames');
 }
 return {prepare:prepare,runtime:runtime,flushProgram:flushProgram};
})();
