/* Local media preparation for the example frontends. GPL-2.0-or-later. */
async function SAEF_Media_load(blob, kind) {
	var archive = await SAEF_Archive.open(blob.name, await blob.arrayBuffer());
	var files = archive.entries.filter(function(e) { return !e.directory && !/^__MACOSX\//.test(e.name); });
	if (files.some(function(e) { return /\.slave$/i.test(e.name); }))
		throw new Error("This is a WHDLoad installation. Open the game launcher (index.htm) to boot it; its Disk.1 file is not a standalone floppy.");
	var pattern = kind === "floppy" ? /\.(adz|(adf|dms|scp|img|exe)(\.gz)?)$/i : /\.(hdz|(hdf|vhd)(\.gz)?)$/i;
	var candidates = archive.type === "plain" ? files : files.filter(function(e) { return pattern.test(e.name); });
	if (!candidates.length) throw new Error("No supported " + kind + " images found in " + blob.name + ".");
	var entry = candidates[0];
	if (candidates.length > 1) {
		var answer = prompt("Choose an image number from " + blob.name + ":\n" + candidates.map(function(e, i) { return (i + 1) + ": " + e.name; }).join("\n"), "1");
		if (answer === null) return null;
		if (!/^\d+$/.test(answer.trim()) || Number(answer) < 1 || Number(answer) > candidates.length) throw new Error("Invalid archive image number.");
		entry = candidates[Number(answer) - 1];
	}
	var data = await entry.read(), name = entry.name;
	if ((archive.type === "zip" || archive.type === "lha") && /\.(adz|hdz|gz)$/i.test(name)) {
		var inner = await SAEF_Archive.open(name, data);
		if (inner.type !== "gzip") throw new Error("Expected a gzip-compressed image.");
		name = inner.entries[0].name;
		data = await inner.entries[0].read();
	}
	var chunks=[];
	for (var offset=0; offset<data.length; offset+=8192)
		chunks.push(String.fromCharCode.apply(null,data.subarray(offset,offset+8192)));
	return {name:name, data:chunks.join(""), size:data.length, crc32:SAEF_Archive.crc32(data)};
}

function loadMediaFile(blob, kind, callback) {
	SAEF_Media_load(blob, kind).then(function(file) {
		if (file) callback(file);
	}).catch(function(error) { alert("Unable to load " + blob.name + ": " + error.message); });
}
