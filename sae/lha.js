/* LHA header levels 0-3 and -lh0-/-lh4-/-lh5-/-lh6-/-lh7- decoding.
 * Adapted using Lhasa's lh_new_decoder.c, lha_file_header.c and ext_header.c:
 * https://github.com/fragglet/lhasa
 *
 * Copyright (c) 2011, 2012, Simon Howard
 * Permission to use, copy, modify, and/or distribute this software
 * for any purpose with or without fee is hereby granted, provided
 * that the above copyright notice and this permission notice appear
 * in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
 * WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
 * AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR
 * CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
 * NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
var SAEF_LHA = (function() {
 "use strict";
 function fail(message) {throw new Error(message);}
 function crc16(data) {
  var crc=0;
  for(var i=0;i<data.length;i++) {crc^=data[i];for(var j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xa001:0);}
  return crc;
 }
 function decode(data,size,method) {
  if(method==='-lh0-' || method==='-lz4-') {
   if(data.length!==size) fail('LHA stored size mismatch.');
   return data.slice();
  }
  if(!/^-lh[4567]-$/.test(method)) fail('Unsupported LHA compression method '+method+'. Supported methods: lh0, lh4, lh5, lh6, lh7.');
  var historyBits=method==='-lh7-'?16:method==='-lh6-'?15:13;
  var offsetBits=historyBits>13?5:4, ring=new Uint8Array(1<<historyBits); ring.fill(32);
  var output=new Uint8Array(size), out=0, pos=0, bit=0, mask=ring.length-1;
  function bits(n) {
   if(bit+n>data.length*8) fail('Truncated LHA compressed data.');
   var value=0;
   while(n--) {value=value*2+((data[bit>>>3]>>>(7-(bit&7)))&1);bit++;}
   return value;
  }
  function single(symbol,max) {if(symbol>=max)fail('Invalid LHA Huffman symbol.');return {symbol:symbol};}
  function tree(lengths) {
   var counts=new Array(17).fill(0), next=new Array(17).fill(0), code=0, root={};
   lengths.forEach(function(n) {if(n<0||n>16)fail('Invalid LHA code length.');if(n)counts[n]++;});
   for(var i=1;i<=16;i++) {code=(code+counts[i-1])*2;next[i]=code;if(code+counts[i]>(1<<i))fail('Oversubscribed LHA Huffman tree.');}
   if(code+counts[16]!==65536) fail('Incomplete LHA Huffman tree.');
   lengths.forEach(function(n,symbol) {
    if(!n)return;
    var value=next[n]++, node=root;
    for(var j=n-1;j>=0;j--) {var branch=(value>>>j)&1; if(!node[branch])node[branch]={};node=node[branch];}
    node.symbol=symbol;
   });
   return root;
  }
  function symbol(root) {
   var node=root;
   for(var i=0;i<=16;i++) {if(node && node.symbol!==undefined)return node.symbol;node=node&&node[bits(1)];}
   fail('Invalid LHA Huffman code.');
  }
  function lengthTable(width,max,special) {
   var n=bits(width); if(!n)return single(bits(width),max);
   if(n>max)fail('Invalid LHA table size.');
   var lengths=new Array(n).fill(0), i=0;
   while(i<n) {
    var length=bits(3);
    if(length===7)while(bits(1)) {length++;if(length>16)fail('Invalid LHA code length.');}
    lengths[i++]=length;
    if(i===special) {var skip=bits(2);if(i+skip>n)fail('Invalid LHA table skip.');i+=skip;}
   }
   return tree(lengths);
  }
  function codeTable(temp) {
   var n=bits(9);if(!n)return single(bits(9),510);
   if(n>510)fail('Invalid LHA code table size.');
   var lengths=new Array(n).fill(0), i=0;
   while(i<n) {
    var value=symbol(temp);
    if(value<=2) {var skip=value===0?1:value===1?bits(4)+3:bits(9)+20;if(i+skip>n)fail('Invalid LHA zero run.');i+=skip;}
    else lengths[i++]=value-2;
   }
   return tree(lengths);
  }
  function emit(value) {output[out++]=value;ring[pos]=value;pos=(pos+1)&mask;}
  while(out<size) {
   var commands=bits(16), temp=lengthTable(5,19,3), codes=codeTable(temp), offsets=lengthTable(offsetBits,historyBits+1,-1);
   if(!commands) fail('Empty LHA compressed block.');
   while(commands-- && out<size) {
    var value=symbol(codes);
    if(value<256)emit(value);
    else {
     var count=value-253, offset=symbol(offsets);
     if(offset>1)offset=(1<<(offset-1))+bits(offset-1);
     if(offset>mask || out+count>size)fail('Invalid LHA back-reference.');
     var source=(pos-offset-1)&mask;
     while(count--) {emit(ring[source]);source=(source+1)&mask;}
    }
   }
  }
  return output;
 }
 function read(data,validatePath,limits) {
  var view=new DataView(data.buffer,data.byteOffset,data.byteLength), result=[], total=0, cursor=0, names=Object.create(null);
  function range(p,n) {if(p<0||n<0||p+n>data.length)fail('Truncated LHA archive.');}
  function u16(p) {range(p,2);return view.getUint16(p,true);}
  function u32(p) {range(p,4);return view.getUint32(p,true);}
  function text(p,n) {range(p,n);return SAEF_Array2String(data.subarray(p,p+n));}
  while(cursor<data.length) {
   // A zero byte terminates the archive. Level 2 headers can have a zero low byte.
   if(data[cursor]===0 && !(cursor+22<=data.length && data[cursor+20]===2 && data[cursor+2]===45)) {
    if(data.subarray(cursor).some(function(b) {return b!==0;}))fail('Unexpected data after LHA terminator.');
    break;
   }
   if(result.length>=limits.entries) fail('Too many entries in LHA archive.');
   range(cursor,22);
   var method=text(cursor+2,5), packed=u32(cursor+7), size=u32(cursor+11), level=data[cursor+20];
   if(!/^-(lh[0-9d]|lz[45s])-$/i.test(method))fail('Invalid LHA method header.');
   if(size>limits.file || (total+=size)>limits.total)fail('LHA archive exceeds the decompressed size limit.');
   var end, ext, name='', directory='', checksum, headerCRC=-1, crcOffset=-1, field=2;
   if(level===0 || level===1) {
    end=cursor+data[cursor]+2;range(cursor,end-cursor);
    var minimum=level===0?24:27, n=data[cursor+21];
    if(end-cursor<minimum+n)fail('Invalid LHA base header size.');
    var sum=0;for(var p=cursor+2;p<end;p++)sum=(sum+data[p])&255;
    if(sum!==data[cursor+1])fail('LHA header checksum mismatch.');
    name=text(cursor+22,n);checksum=u16(cursor+22+n);
    if(level===1)ext=end-2;
    else {
     var unix=cursor+24+n;
     if(end-unix>=12 && data[unix]===85 && (u16(end-6)&0xf000)===0xa000)fail('LHA symbolic links are not supported.');
    }
   } else if(level===2 || level===3) {
    if(level===2) {end=cursor+u16(cursor);ext=cursor+24;}
    else {if(u16(cursor)!==4)fail('Unsupported LHA header word size.');end=cursor+u32(cursor+24);ext=cursor+28;field=4;}
    if(end-cursor<(level===2?26:32) || end-cursor>1024*1024)fail('Invalid LHA header size.');
    range(cursor,end-cursor); checksum=u16(cursor+21);
   } else fail('Unsupported LHA header level '+level+'.');
   if(level>0) {
    for(;;) {
     if(level!==1 && ext+field>end)fail('Truncated LHA extended header.');
     var length=field===2?u16(ext):u32(ext);if(!length)break;
     if(length<field+1)fail('Invalid LHA extended header length.');
     if(level===1) {packed-=length;end+=length;if(packed<0||end-cursor>1024*1024)fail('Invalid LHA extended header size.');}
     if(ext+length+field>end)fail('LHA extended header exceeds header bounds.');
     range(ext,length+field);
     var type=data[ext+field], at=ext+field+1, len=length-field-1;
     if(type===0) {if(len<2)fail('Invalid LHA CRC header.');headerCRC=u16(at);crcOffset=at;}
     else if(type===1) name=text(at,len);
     else if(type===2) {directory=text(at,len).replace(/\xff/g,'/');if(directory && !/\/$/.test(directory))directory+='/';}
     else if(type===0x50 && len>=2 && (u16(at)&0xf000)===0xa000)fail('LHA symbolic links are not supported.');
     else if(type===0x42)fail('64-bit LHA sizes are not supported.');
     else if(type===0x39)fail('Multi-volume LHA archives are not supported.');
     ext+=length;
    }
   }
   range(cursor,end-cursor);
   if(headerCRC>=0) {var header=data.slice(cursor,end);header[crcOffset-cursor]=header[crcOffset-cursor+1]=0;if(crc16(header)!==headerCRC)fail('LHA header CRC mismatch.');}
   name=validatePath(directory+name);
   if(!name)fail('Empty LHA entry name.');
   var isDirectory=method==='-lhd-' || /\/$/.test(name);if(isDirectory && !/\/$/.test(name))name+='/';
   if(!name || names[name])fail('Empty or duplicate LHA entry name.');names[name]=true;
   if(isDirectory && (size || packed))fail('Invalid LHA directory entry.');
   range(end,packed);
   result.push(entry(name,method,data.subarray(end,end+packed),size,checksum,isDirectory));
   cursor=end+packed;
  }
  return result;
 }
 function entry(name,method,data,size,checksum,directory) {
  return {name:name,size:size,directory:directory,read:async function() {
   if(directory)return new Uint8Array();
   var result=decode(data,size,method);if(crc16(result)!==checksum)fail('LHA file CRC mismatch: '+name);return result;
  }};
 }
 return {read:read,crc16:crc16};
})();
