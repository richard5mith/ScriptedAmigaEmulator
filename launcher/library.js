/* Shared library discovery and archive routing. GPL-2.0-or-later. */
var SAELibrary = (function() {
  'use strict';
  const imagePattern = /\.(adf|adz|dms|scp|img|exe|hdf|hdz|vhd)(\.gz)?$/i;
  const archivePattern = /\.(zip|lha|lzh)$/i;
  const diskPattern = /\s*[\[(]?\s*(?:disk|disc)\s*[-_ ]?(\d+)(?:\s*(?:of|\/)\s*\d+)?\s*[\])]?/i;
  const basename = path => path.split('/').pop();
  function normalize(path) {
    const parts = path.replace(/\\/g, '/').split('/');
    const start = parts.findIndex(p => /^(games|bios)$/i.test(p));
    return (start >= 0 ? parts.slice(start) : parts).join('/');
  }
  function title(path) {
    return basename(path).replace(/\.(zip|lha|lzh|adf|adz|dms|scp|img|exe|hdf|hdz|vhd)(\.gz)?$/i, '')
      .replace(/[_]+/g, ' ').replace(/\s*\[[^\]]*\]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+v\d.*$/i, '').trim() || basename(path);
  }
  function isSystem(file) {
    return /^bios\//i.test(file.path) || /\.(rom|rtb|key)$/i.test(file.name) || /^(WHDLoad(?:_usr)?(?:\.(lha|zip|lzh))?|kick.*\.(bin|rom))$/i.test(file.name);
  }
  function group(files) {
    const system = [], games = [], groups = new Map();
    files = files.filter(f => !f.path.split('/').some(p => p.startsWith('.')));
    for (const file of files) if (isSystem(file)) system.push(file);
    const gameFiles = files.filter(f => !isSystem(f));
    // An extracted WHDLoad installation is one game, not a card per data file.
    const roots = [...new Set(gameFiles.filter(f => /\.slave$/i.test(f.name)).map(f => f.path.slice(0, f.path.lastIndexOf('/') + 1)))];
    for (const root of roots) {
      const members = gameFiles.filter(f => f.path.startsWith(root));
      games.push({id:root, title:title(root.replace(/\/$/, '')), files:members, kind:'folder'});
    }
    for (const file of gameFiles) {
      if (roots.some(root => file.path.startsWith(root))) continue;
      if (!imagePattern.test(file.name) && !archivePattern.test(file.name)) continue;
      const disk = file.name.match(diskPattern);
      if (disk && imagePattern.test(file.name) && !/\.(hdf|hdz|vhd)/i.test(file.name)) {
        const name = file.name.replace(diskPattern, '');
        const key = file.path.slice(0, file.path.lastIndexOf('/') + 1) + name.toLowerCase();
        if (!groups.has(key)) groups.set(key, {id:key, title:title(name), files:[], kind:'disks'});
        groups.get(key).files.push(file);
      } else games.push({id:file.path, title:title(file.name), files:[file], kind:'file'});
    }
    for (const game of groups.values()) {
      game.files.sort((a,b) => Number(a.name.match(diskPattern)[1]) - Number(b.name.match(diskPattern)[1]));
      games.push(game);
    }
    games.sort((a,b) => a.title.localeCompare(b.title, undefined, {numeric:true}));
    return {games, system};
  }
  function source(file, prefix='') {
    const path = normalize(prefix + (file.webkitRelativePath || file.name));
    return {path, name:basename(path), size:file.size, read:async () => new Uint8Array(await file.arrayBuffer())};
  }
  function remote(file) {
    const url = new URL(file.url, location.href);
    if (url.origin !== location.origin) throw new Error('Library files must be served from this site.');
    return {...file, read:async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not read ' + file.name + '. Refresh your library and try again.');
      return new Uint8Array(await response.arrayBuffer());
    }};
  }
  async function discover() {
    const response = await fetch('api/library', {cache:'no-store'});
    if (response.ok && (response.headers.get('content-type') || '').includes('application/json')) {
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (!Array.isArray(data.files)) throw new Error('Invalid library response.');
      return data.files.map(remote);
    }
    // Plain static servers (including python -m http.server) can expose directory indexes.
    const found = [], visited = new Set();
    async function walk(url, root, depth) {
      if (visited.has(url.href) || depth > 12) return;
      if (visited.size >= 1000 || found.length >= 10000) throw new Error('This library is too large to scan. Choose a smaller folder.');
      visited.add(url.href);
      const result = await fetch(url);
      if (!result.ok || !result.headers.get('content-type')?.includes('text/html')) return;
      const doc = new DOMParser().parseFromString(await result.text(), 'text/html');
      for (const link of doc.querySelectorAll('a[href]')) {
        const next = new URL(link.getAttribute('href'), url);
        if (next.origin !== url.origin || !next.pathname.startsWith(root.pathname) || next.search || next.hash || next.pathname === url.pathname) continue;
        const relative = decodeURIComponent(next.pathname.slice(root.pathname.length));
        if (relative.split('/').some(p => p.startsWith('.') || p === '..')) continue;
        if (next.pathname.endsWith('/')) await walk(next, root, depth + 1);
        else if (!found.some(f => f.url === next.href)) found.push({path:root.pathname.split('/').filter(Boolean).pop()+'/'+relative, name:basename(relative), url:next.href});
      }
    }
    for (const name of ['games/', 'bios/']) {const root = new URL(name, location.href); await walk(root, root, 0);}
    return found.map(remote);
  }
  async function inspect(game) {
    let archive;
    if (game.kind === 'folder') {
      const prefix = game.id;
      archive = {type:'folder', entries:game.files.map(f => ({name:f.path.slice(prefix.length), size:f.size || 0, directory:false, read:f.read}))};
    } else if (game.kind === 'disks') {
      archive = {type:'disks', entries:game.files.map(f => ({name:f.name, size:f.size || 0, directory:false, read:f.read}))};
    } else archive = await SAEF_Archive.open(game.files[0].name, await game.files[0].read());
    const entries = archive.entries.filter(e => !e.directory && !/^__MACOSX\//.test(e.name));
    const slaves = entries.filter(e => /\.slave$/i.test(e.name));
    if (slaves.length) return {type:'whdload', archive, variants:slaves};
    const disks = entries.filter(e => /\.(adf|adz|dms|scp|img|exe)(\.gz)?$/i.test(e.name));
    const hardfiles = entries.filter(e => /\.(hdf|hdz|vhd)(\.gz)?$/i.test(e.name));
    if (disks.length) return {type:'floppy', archive, variants:disks.sort((a,b) => a.name.localeCompare(b.name,undefined,{numeric:true}))};
    if (hardfiles.length) return {type:'hardfile', archive, variants:hardfiles};
    throw new Error('No playable game found in this archive. Add a disk image or an installed WHDLoad game.');
  }
  async function image(entry) {
    const data = await entry.read();
    if (/\.(adz|hdz|gz)$/i.test(entry.name)) {
      const inner = await SAEF_Archive.open(entry.name, data);
      return {name:inner.entries[0].name, data:await inner.entries[0].read()};
    }
    return {name:entry.name, data};
  }
  function chooseRom(roms, model, override) {
    if (override && override !== 'auto') return roms.find(r => r.path === override);
    const target = model === 'A500+' ? 'A500' : model;
    return roms.map(rom => {
      const modern = ['A1200','A3000','A4000'].includes(model);
      const ver = rom.info?.subVer || (/13|1\.3/.test(rom.name) ? 34 : /31|3\.1/.test(rom.name) ? 40 : 0);
      let score = (rom.info?.models || '').includes(target) ? 100 : 0;
      score += modern ? (ver >= 39 ? 40 : -100) : model === 'A500' ? (ver === 34 ? 150 : 0) : (ver >= 37 ? 40 : -50);
      score += /kick/i.test(rom.name) ? 5 : 0;
      return {rom,score,eligible:!modern || ver >= 39};
    }).filter(item=>item.eligible).sort((a,b) => b.score-a.score || a.rom.path.localeCompare(b.rom.path))[0]?.rom;
  }
  return {group, title, normalize, source, remote, discover, inspect, image, chooseRom};
})();
