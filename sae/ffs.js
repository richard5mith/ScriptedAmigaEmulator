/* Build a standard DOS\1 (FFS) partition for SAE's existing IDE controller.
 * GPL-2.0-or-later. Block layout: ADFlib src/adf_blk.h and AmigaDOS FFS.
 * Deliberately limited to 48 MiB (25 bitmap pages) and 30-byte names.
 */
function SAEF_FFS_create(files, label) {
 "use strict";
 function fail(message) { throw new Error(message); }
 function valid(name) {
  if (!name || name.length > 30 || /[\x00-\x1f\/:]/.test(name) || name === '.' || name === '..' || Array.from(name).some(function(c) {return c.charCodeAt(0)>255;}))
   fail('Unsupported Amiga filename: ' + name + ' (maximum 30 Latin-1 characters).');
 }
 function key(name) { return name.replace(/[a-z]/g, function(c) {return c.toUpperCase();}); }
 valid(label);
 var root={name:label, children:[]}, nodes=[root], paths=Object.create(null), required=4;
 paths['']=root;
 files.forEach(function(file) {
  var parts=file.name.replace(/\/$/,'').split('/'), parent=root, current='';
  parts.forEach(function(name,i) {
   valid(name); current+=(current?'/':'')+key(name);
   var directory=i<parts.length-1 || file.directory;
   var node=paths[current];
   if(node) {
    if(!directory || !node.children) fail('Conflicting Amiga path: '+file.name);
   } else {
    node={name:name,parent:parent};
    if(directory) node.children=[];
    else { node.data=file.data; if(!(node.data instanceof Uint8Array)) fail('Missing data: '+file.name); }
    paths[current]=node; nodes.push(node); parent.children.push(node); required++;
    if(!directory) {var blocks=Math.ceil(node.data.length/512); required+=blocks+Math.max(0,Math.ceil(blocks/72)-1);}
   }
   parent=node;
  });
 });
 var blocks=Math.ceil(Math.max(8*1024*1024, (required*512+1024*1024)*1.1)/16384)*32;
 if(blocks*512>48*1024*1024) fail('This installation exceeds the 48 MiB generated hardfile limit.');
 var image=new Uint8Array(blocks*512), view=new DataView(image.buffer), used=new Uint8Array(blocks), checks=[];
 function put(block,word,value) {view.setUint32(block*512+word*4,value>>>0,false);}
 function get(block,word) {return view.getUint32(block*512+word*4,false);}
 function checksum(block,word) {put(block,word,0); var sum=0; for(var i=0;i<128;i++) sum=(sum+get(block,i))>>>0; put(block,word,-sum);}
 function bstr(block,offset,name) { image[block*512+offset]=name.length; for(var i=0;i<name.length;i++) image[block*512+offset+i+1]=name.charCodeAt(i); }
 var cursor=2;
 function alloc() {while(used[cursor]) cursor++; if(cursor>=blocks) fail('Hardfile allocation overflow.'); used[cursor]=1; return cursor++;}
 used[0]=used[1]=1; root.block=blocks/2; used[root.block]=1;
 var bitmap=[];
 for(var b=0;b<Math.ceil((blocks-2)/4064);b++) bitmap.push(alloc());
 nodes.slice(1).forEach(function(node) {node.block=alloc();});
 put(0,0,0x444f5301); put(0,2,root.block);
 // Hard disks boot via the ROM filesystem; they do not need floppy boot code.
 put(root.block,0,2); put(root.block,3,72); put(root.block,78,0xffffffff); put(root.block,127,1); bstr(root.block,432,label);
 bitmap.forEach(function(block,i) {put(root.block,79+i,block);}); checks.push(root.block);
 nodes.slice(1).forEach(function(node) {
  var block=node.block; put(block,0,2); put(block,1,block); put(block,125,node.parent.block); put(block,127,node.children?2:-3); bstr(block,432,node.name); checks.push(block);
  if(!node.children) {
   put(block,81,node.data.length);
   var count=Math.ceil(node.data.length/512), header=block;
   for(var i=0;i<count;i++) {
    if(i && i%72===0) {var ext=alloc(); put(header,126,ext); header=ext; put(header,0,16); put(header,1,header); put(header,125,block); put(header,127,-3); checks.push(header);}
    var dataBlock=alloc(); if(i===0) put(block,4,dataBlock); image.set(node.data.subarray(i*512,(i+1)*512),dataBlock*512); put(header,77-i%72,dataBlock); put(header,2,i%72+1);
   }
  }
 });
 nodes.filter(function(node) {return node.children;}).forEach(function(dir) {
  dir.children.forEach(function(child) {
   var name=key(child.name), hash=name.length;
   for(var i=0;i<name.length;i++) hash=(hash*13+name.charCodeAt(i))&0x7ff;
   var slot=6+hash%72; put(child.block,124,get(dir.block,slot)); put(dir.block,slot,child.block);
  });
 });
 for(var block=2;block<blocks;block++) if(!used[block]) {
  var bit=block-2, page=bitmap[Math.floor(bit/4064)], word=1+Math.floor(bit%4064/32);
  put(page,word,get(page,word)|(1<<(bit%32)));
 }
 checks.forEach(function(block) {checksum(block,5);}); bitmap.forEach(function(block) {checksum(block,0);});
 return image;
}
