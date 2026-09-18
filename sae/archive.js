/* Browser-side archive preparation. GPL-2.0-or-later, like SAE.
 * Decompression happens before the emulator's synchronous file API is called.
 */
var SAEF_Archive = (function() {
	"use strict";
	var MAX_FILE = 256 * 1024 * 1024;
	var MAX_TOTAL = 512 * 1024 * 1024;
	var MAX_ENTRIES = 10000;

	function fail(message) { throw new Error(message); }
	function bytes(data) {
		if (typeof data === "string") return SAEF_String2Array(data);
		if (data instanceof Uint8Array) return data;
		return new Uint8Array(data);
	}
	function crc(data) {
		var value = 0xffffffff;
		for (var i = 0; i < data.length; i++) {
			value ^= data[i];
			for (var j = 0; j < 8; j++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
		}
		return (value ^ 0xffffffff) >>> 0;
	}
	function path(name) {
		name = name.replace(/\\/g, "/");
		if (/^[\/]|[\x00-\x1f:]/.test(name) || name.split("/").some(function(p) { return p === ".." || p === "."; }))
			fail("Unsafe archive path: " + name);
		return name;
	}
	async function inflate(data, format, limit) {
		if (typeof DecompressionStream === "undefined") fail("This browser does not support archive decompression. Please use a current browser or extract the archive first.");
		var stream;
		try { stream = new DecompressionStream(format); }
		catch (e) { fail("This browser does not support " + format + " decompression. Please extract the archive first."); }
		var reader = new Blob([data]).stream().pipeThrough(stream).getReader();
		var chunks = [], size = 0;
		try {
			for (;;) {
				var chunk = await reader.read();
				if (chunk.done) break;
				size += chunk.value.length;
				if (size > limit) { await reader.cancel(); fail("Decompressed file exceeds the size limit."); }
				chunks.push(chunk.value);
			}
		} finally { reader.releaseLock(); }
		var result = new Uint8Array(size), offset = 0;
		chunks.forEach(function(chunk) { result.set(chunk, offset); offset += chunk.length; });
		return result;
	}
	function zip(data) {
		var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		function range(offset, length) {
			if (offset < 0 || length < 0 || offset + length > data.length) fail("Truncated ZIP archive.");
		}
		function u16(p) { range(p, 2); return view.getUint16(p, true); }
		function u32(p) { range(p, 4); return view.getUint32(p, true); }
		var end = -1;
		for (var p = data.length - 22; p >= Math.max(0, data.length - 65557); p--) {
			if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === data.length) { end = p; break; }
		}
		if (end < 0) fail("Invalid or truncated ZIP directory.");
		if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) fail("Split ZIP archives are not supported.");
		var count = u16(end + 10), length = u32(end + 12), start = u32(end + 16);
		if (count === 65535 || length === 0xffffffff || start === 0xffffffff) fail("ZIP64 archives are not supported.");
		if (count > MAX_ENTRIES) fail("Too many entries in ZIP archive.");
		range(start, length);
		if (start + length > end) fail("Invalid ZIP directory bounds.");
		var entries = [], total = 0, names = Object.create(null);
		p = start;
		for (var i = 0; i < count; i++) {
			if (u32(p) !== 0x02014b50) fail("Invalid ZIP directory entry.");
			range(p, 46);
			var flags = u16(p + 8), method = u16(p + 10), checksum = u32(p + 16);
			var packed = u32(p + 20), size = u32(p + 24), n = u16(p + 28);
			var next = p + 46 + n + u16(p + 30) + u16(p + 32), local = u32(p + 42);
			if (next > start + length) fail("Truncated ZIP directory entry.");
			if (u16(p + 34)) fail("Split ZIP archives are not supported.");
			if (flags & 0x41) fail("Encrypted ZIP archives are not supported.");
			if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) fail("ZIP64 archives are not supported.");
			if (size > MAX_FILE || (total += size) > MAX_TOTAL) fail("ZIP archive exceeds the decompressed size limit.");
			var rawName = data.subarray(p + 46, p + 46 + n);
			var name = path(flags & 0x800 ? new TextDecoder("utf-8", {fatal:true}).decode(rawName) : SAEF_Array2String(rawName));
			if (!name || names[name]) fail("Empty or duplicate ZIP entry name.");
			names[name] = true;
			if (((u32(p + 38) >>> 16) & 0xf000) === 0xa000) fail("ZIP symbolic links are not supported.");
			if (u32(local) !== 0x04034b50 || u16(local + 8) !== method || u16(local + 6) !== flags) fail("Invalid ZIP local header.");
			var localNameLength = u16(local + 26), begin = local + 30 + localNameLength + u16(local + 28);
			range(local + 30, localNameLength);
			if (localNameLength !== n || !rawName.every(function(b, j) { return b === data[local + 30 + j]; })) fail("ZIP entry names do not match.");
			range(begin, packed);
			if (begin + packed > start) fail("ZIP entry overlaps its directory.");
			entries.push(makeEntry(name, method, data.subarray(begin, begin + packed), size, checksum));
			p = next;
		}
		if (p !== start + length) fail("Invalid ZIP directory size.");
		return entries;
	}
	function makeEntry(name, method, data, size, checksum) {
		return { name: name, size: size, directory: /\/$/.test(name), read: async function() {
			var result;
			if (method === 0) result = data.slice();
			else if (method === 8) result = await inflate(data, "deflate-raw", size);
			else fail("Unsupported ZIP compression method " + method + " for " + name);
			if (result.length !== size || crc(result) !== checksum) fail("ZIP checksum or size mismatch: " + name);
			return result;
		} };
	}
	async function open(name, input) {
		var data = bytes(input);
		if (data.length > MAX_TOTAL) fail("Input file exceeds the size limit.");
		if (data[0] === 0x50 && data[1] === 0x4b) return {type:"zip", entries:zip(data)};
		if (data[2] === 45 && data[3] === 108 && data[6] === 45) {
			if (typeof SAEF_LHA === "undefined") fail("Load sae/lha.js before opening LHA archives.");
			return {type:"lha", entries:SAEF_LHA.read(data, path, {file:MAX_FILE, total:MAX_TOTAL, entries:MAX_ENTRIES})};
		}
		if (data[0] === 0x1f && data[1] === 0x8b) {
			var unpacked = await inflate(data, "gzip", MAX_FILE);
			var filename = name.replace(/\.adz$/i, ".adf").replace(/\.hdz$/i, ".hdf").replace(/\.gz$/i, "");
			return {type:"gzip", entries:[{name:filename, size:unpacked.length, directory:false, read:async function() {return unpacked;}}]};
		}
		if (/\.(zip|lha|lzh|adz|hdz|gz)$/i.test(name)) fail("The selected file is not a valid ZIP, LHA, or gzip archive.");
		return {type:"plain", entries:[{name:name, size:data.length, directory:false, read:async function() {return data;}}]};
	}
	return {open:open, crc32:crc};
})();
