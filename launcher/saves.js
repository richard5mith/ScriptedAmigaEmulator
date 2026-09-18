/* Durable copies of writable media; never modifies the source archive. GPL-2.0-or-later. */
var SAESaves = (function() {
  'use strict';
  const DATABASE='sae-game-saves', LIMIT=256*1024*1024;
  async function hash(data) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function open() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DATABASE,1);
      request.onupgradeneeded=()=>{const store=request.result.createObjectStore('media',{keyPath:'key'});store.createIndex('gameId','gameId');};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Close other launcher tabs to open game saves.'));
      request.onsuccess=()=>resolve(new Store(request.result));
    });
  }
  class Store {
    constructor(db){this.db=db;db.onversionchange=()=>db.close();}
    read(key){return this.transaction('readonly',store=>store.get(key));}
    list(gameId){return this.transaction('readonly',store=>store.index('gameId').getAll(gameId));}
    transaction(mode,action){return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('media',mode),request=action(tx.objectStore('media'));let value;
      if(request)request.onsuccess=()=>value=request.result;
      tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||new Error('Saving was interrupted.'));tx.onerror=()=>{};
    });}
    // The revision check prevents one tab silently replacing another tab's save.
    write(record,expected){return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('media','readwrite'),store=tx.objectStore('media'),request=store.get(record.key);let conflict=false;
      request.onsuccess=()=>{
        if((request.result?.revision||0)!==expected){conflict=true;tx.abort();return;}
        store.put(record);
      };
      tx.oncomplete=()=>resolve();tx.onerror=()=>{};
      tx.onabort=()=>reject(conflict?new Error('This game was saved in another tab. Export this session before closing it.'):tx.error||new Error('Could not save game.'));
    });}
    // An import is atomic: invalid/failed imports never partially replace saves.
    replace(records){return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('media','readwrite'),store=tx.objectStore('media');
      for(const record of records){const request=store.get(record.key);request.onsuccess=()=>store.put({...record,revision:(request.result?.revision||0)+1});}
      tx.oncomplete=resolve;tx.onerror=()=>{};tx.onabort=()=>reject(tx.error||new Error('Could not import saves.'));
    });}
  }
  async function lock(gameId) {
    if(!navigator.locks) return ()=>{};
    return new Promise((resolve,reject)=>{
      navigator.locks.request('sae-game:'+gameId,{ifAvailable:true},async lock=>{
        if(!lock){reject(new Error('This game is open in another tab. Close it there before playing.'));return;}
        await new Promise(release=>resolve(release));
      }).catch(reject);
    });
  }
  class Session {
    constructor(store,gameId,changed=()=>{}){this.store=store;this.gameId=gameId;this.changed=changed;this.media=new Map();this.timer=null;this.pending=null;this.closed=false;this.error=null;}
    get dirty(){return [...this.media.values()].some(item=>item.version!==item.saved);}
    async mount(image,medium,readonly=false) {
      const baseHash=await hash(image.data),key=JSON.stringify([this.gameId,medium,baseHash]);
      let item=this.media.get(key);
      if(!item){
        const record=await this.store.read(key);
        if(record && (!(record.data instanceof Uint8Array)||record.data.length>LIMIT||record.baseHash!==baseHash||await hash(record.data)!==record.hash))
          throw new Error('The stored save is damaged. Import a backup before playing.');
        item={key,gameId:this.gameId,medium,baseHash,name:record?.name||image.name,data:record?record.data.slice():image.data,version:0,saved:0,revision:record?.revision||0,updatedAt:record?.updatedAt||0};
        this.media.set(key,item);
        if(record)this.changed('restored',record.updatedAt);
      }
      return {name:item.name,data:item.data,size:item.data.length,crc32:false,onWrite:readonly?null:(data,size,name)=>{
        if(this.closed)return;
        // Keep the live backing buffer even if SAE later closes the disk handle.
        item.data=data.subarray(0,size);item.name=name;item.version++;
        this.changed('saving');
        if(this.timer)clearTimeout(this.timer);
        this.timer=setTimeout(()=>{this.timer=null;this.flush().catch(()=>{});},1000);
      }};
    }
    async flush() {
      if(this.timer){clearTimeout(this.timer);this.timer=null;}
      if(this.pending){await this.pending;if(this.dirty)return this.flush();return;}
      this.pending=(async()=>{
        for(const item of this.media.values()) {
          if(item.version===item.saved)continue;
          const version=item.version,data=item.data.slice(),updatedAt=Date.now(),revision=item.revision+1;
          if(data.length>LIMIT)throw new Error('Save exceeds the 256 MiB limit.');
          const record={key:item.key,gameId:item.gameId,medium:item.medium,baseHash:item.baseHash,name:item.name,data,hash:await hash(data),updatedAt,revision};
          await this.store.write(record,item.revision);
          item.saved=version;item.revision=revision;item.updatedAt=updatedAt;
        }
        this.error=null;this.changed(this.dirty?'saving':'saved');
      })();
      try{await this.pending;}catch(error){this.error=error;this.changed('error',error);throw error;}finally{this.pending=null;}
      if(this.dirty)return this.flush();
    }
    close(){this.closed=true;if(this.timer)clearTimeout(this.timer);this.timer=null;}
    async records(){
      const records=new Map((await this.store.list(this.gameId)).map(r=>[r.key,r]));
      for(const item of this.media.values())if(item.version!==item.saved){const data=item.data.slice();records.set(item.key,{key:item.key,gameId:item.gameId,medium:item.medium,baseHash:item.baseHash,name:item.name,data,hash:await hash(data),updatedAt:Date.now(),revision:item.revision});}
      return [...records.values()];
    }
  }
  function base64(data){let s='';for(let i=0;i<data.length;i+=8192)s+=String.fromCharCode.apply(null,data.subarray(i,i+8192));return btoa(s);}
  async function exportFile(records,title) {
    if(!records.length)throw new Error('No saved disk changes yet. Use Save inside the game first.');
    return new Blob([JSON.stringify({format:'SAE disk saves',version:1,title,media:records.map(r=>({...r,data:base64(r.data)}))})],{type:'application/json'});
  }
  async function importFile(file,gameId,store) {
    if(file.size>LIMIT*1.4)throw new Error('Save backup is too large.');
    const backup=JSON.parse(await file.text());
    if(backup.format!=='SAE disk saves'||backup.version!==1||!Array.isArray(backup.media)||!backup.media.length||backup.media.length>100)throw new Error('Not a supported save backup.');
    let total=0;const records=[],seen=new Set();
    for(const item of backup.media){
      if(typeof item.medium!=='string'||typeof item.name!=='string'||typeof item.data!=='string'||!/^[a-f0-9]{64}$/.test(item.baseHash)||!/^[a-f0-9]{64}$/.test(item.hash))throw new Error('Invalid save backup.');
      total+=Math.floor(item.data.length*3/4);if(total>LIMIT)throw new Error('Save backup is too large.');
      const data=Uint8Array.from(atob(item.data),c=>c.charCodeAt(0));
      if(await hash(data)!==item.hash)throw new Error('Save backup is damaged.');
      const key=JSON.stringify([gameId,item.medium,item.baseHash]);if(seen.has(key))throw new Error('Duplicate disk in save backup.');seen.add(key);
      records.push({key,gameId,medium:item.medium,baseHash:item.baseHash,name:item.name,data,hash:item.hash,updatedAt:Date.now(),revision:1});
    }
    await store.replace(records);return records.length;
  }
  return {open,Session,lock,exportFile,importFile,hash};
})();
