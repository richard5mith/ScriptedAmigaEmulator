// Optional integration test. Requires local Qwak.zip, BIOS, Python and Playwright.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const server=spawn(process.env.PYTHON||'python3',['-u','serve.py','--port','18782'],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited: '+code)));});
  // Drain logs so the server never blocks on a full pipe.
  server.stdout.on('data',()=>{});server.stderr.on('data',()=>{});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url='http://127.0.0.1:18782/';
  async function library(){await page.goto(url);await page.getByRole('button',{name:'Play Qwak',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.play-button').disabled);}
  async function play(){await page.getByRole('button',{name:'Play Qwak',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#bootMessage').hidden);}
  await library();
  // Existing version-one disk saves survive the checkpoint-store upgrade.
  await page.evaluate(async()=>{
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open('sae-game-saves',1);
      request.onupgradeneeded=()=>{const store=request.result.createObjectStore('media',{keyPath:'key'});store.createIndex('gameId','gameId');store.put({key:'upgrade-marker',gameId:'upgrade-test',data:new Uint8Array([42])});};
      request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve();};
    });
    const store=await SAESaves.open();if((await store.read('upgrade-marker')).data[0]!==42||!store.db.objectStoreNames.contains('states'))throw Error('Disk-save upgrade lost data');
  });
  await page.evaluate(()=>{
    const open=SAEF_ZFile_fopen_file;
    SAEF_ZFile_fopen_file=function(file){const result=open(file);if(file.name==='Qwak.hdf')window.testMedia=result;return result;};
  });
  await play();
  const marker=[83,65,86,69,84,69,83,84];
  await page.evaluate(marker=>{
    if(!window.testMedia||typeof testMedia.onWrite!=='function')throw new Error('Writable disk hook missing');
    // An otherwise-unused data block: exercises SAE's real disk write path.
    SAEF_ZFile_fseek(testMedia,testMedia.size-marker.length,0);
    SAEF_ZFile_fwrite(new Uint8Array(marker),0,1,marker.length,testMedia);
  },marker);
  await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent==='Disk changes saved');
  await page.getByRole('button',{name:'Back to library',exact:true}).click();await page.getByRole('button',{name:"Yes and don't save state",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playerDialog').open);
  await library();await play();
  assert.deepEqual(await page.evaluate(()=>Array.from(SAEV_config.mount.config[0].ci.file.data.slice(-8))),marker);
  assert.equal(await page.locator('#saveStatus').textContent(),'Saved disk restored');
  await page.getByRole('button',{name:'Back to library',exact:true}).click();await page.getByRole('button',{name:"Yes and don't save state",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playerDialog').open);
  await page.getByRole('button',{name:'Settings for Qwak',exact:true}).click();
  await page.locator('#gameSaves summary').click();
  await page.waitForFunction(()=>document.querySelector('#saveSummary').textContent.startsWith('Saved '));
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export backup',exact:true}).click();assert.equal((await download).suggestedFilename(),'Qwak.saesave');
  const gameId=await page.evaluate(async()=>{
    const store=await SAESaves.open();
    const records=await new Promise((resolve,reject)=>{const r=store.db.transaction('media').objectStore('media').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const record=records.find(r=>r.name==='Qwak.hdf');
    await store.replace([{...record,key:'other-game-disk',gameId:'other-game'}]);
    window.testDeleteLock=await SAESaves.lock(record.gameId);
    return record.gameId;
  });
  // Cancelling preserves saves. Another open game session also prevents deletion.
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Delete stored data',exact:true}).click();
  assert.equal(await page.evaluate(async id=>(await(await SAESaves.open()).list(id)).length,gameId),1);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete stored data',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('another tab'));
  assert.equal(await page.evaluate(async id=>(await(await SAESaves.open()).list(id)).length,gameId),1);
  await page.evaluate(()=>window.testDeleteLock());
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete stored data',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#saveSummary').textContent==='No saved disk changes yet.');
  assert.equal(await page.getByRole('button',{name:'Delete stored data',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(async id=>(await(await SAESaves.open()).list(id)).length,gameId),0);
  assert.equal(await page.evaluate(async()=>(await(await SAESaves.open()).list('other-game')).length),1);
  await library();await play();
  assert.notDeepEqual(await page.evaluate(()=>Array.from(SAEV_config.mount.config[0].ci.file.data.slice(-8))),marker);
  assert.notEqual(await page.locator('#saveStatus').textContent(),'Saved disk restored');
  await page.getByRole('button',{name:'Back to library',exact:true}).click();await page.getByRole('button',{name:"Yes and don't save state",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playerDialog').open);
  // The real IndexedDB backend rejects stale writers and preserves the winner.
  await page.evaluate(async()=>{
    const store=await SAESaves.open(),a=new SAESaves.Session(store,'conflict-test'),b=new SAESaves.Session(store,'conflict-test');
    const image=()=>({name:'disk.adf',data:new Uint8Array([0,0,0,0])});
    const x=await a.mount(image(),'disk'),y=await b.mount(image(),'disk');
    x.onWrite(new Uint8Array([1,1,1,1]),4,x.name);await a.flush();
    y.onWrite(new Uint8Array([2,2,2,2]),4,y.name);
    let rejected=false;try{await b.flush();}catch{rejected=true;}if(!rejected)throw new Error('Stale write accepted');
    if((await store.list('conflict-test'))[0].data[0]!==1)throw new Error('Stale write replaced save');
    a.close();b.close();
  });
  assert.deepEqual(errors,[]);console.log('PASS real disk write, IndexedDB, stop/relaunch, backup, deletion/cancel/lock/isolation/fresh launch, conflict protection');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
