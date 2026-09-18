// Optional integration: installed Playwright/Chromium and local game/BIOS fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const port=process.env.STATE_PORT||'18784';
 const server=spawn('python3',['-u','serve.py','--port',port],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited: '+code)));});
  server.stdout.on('data',()=>{});server.stderr.on('data',()=>{});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(60000);
  if(process.env.STATE_SETTINGS)await page.addInitScript(settings=>localStorage.setItem('sae.launcher.settings',JSON.stringify(settings)),JSON.parse(process.env.STATE_SETTINGS));
  await page.addInitScript(()=>{
    window.hardwareDigest=()=>({regs:JSON.stringify(SAER_CPU_regs),cycle:SAEV_Events_currcycle,
      devices:JSON.stringify(['cia','copper','blitter','audio','events'].map(key=>SAER[key]._saeState.get())),
      chip:SAESaves.hash(SAER_Memory_chipData.slice().buffer),fast:SAESaves.hash(SAER.expansion._saeState.get().fastmem_bank.baseaddr.slice().buffer)});
  });
  const title=process.env.STATE_GAME||'Qwak',url='http://127.0.0.1:'+port+'/';
  async function library(){await page.goto(url);await page.getByRole('button',{name:'Play '+title,exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.play-button').disabled);}
  async function play(){await page.getByRole('button',{name:'Play '+title,exact:true}).click();}
  async function quit(){await page.getByRole('button',{name:'Back to library',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#quitContinue').disabled);}
  await library();await play();await page.waitForFunction(()=>SAER.running);await page.waitForTimeout(Number(process.env.STATE_BOOT_MS||15000));
  async function joy(dir){for(const down of [true,false]){await page.evaluate(({dir,down})=>SAER.input.registerEvent(1,dir==='Fire'?SAEC_Input_Event_Press:SAEC_Input_Event_JoystickMove,dir==='Fire'?SAEC_Input_Button_1:({Left:1,Right:2,Up:4,Down:8})[dir],down),{dir,down});await page.waitForTimeout(down?150:600);}}
  if(process.env.STATE_CAREER){
    await joy('Fire');await page.waitForTimeout(2000);await page.screenshot({path:'/private/tmp/sae-career-main.png'});
    for(let i=0;i<4;i++)await joy('Down');await page.screenshot({path:'/private/tmp/sae-career-menu.png'});await joy('Fire');await page.screenshot({path:'/private/tmp/sae-career-form.png'});
    for(let i=0;i<3;i++)await joy('Down');await joy('Fire');
    for(let i=0;i<4;i++){await joy('Fire');await page.waitForTimeout(1000);}
    await joy('Fire');await page.waitForTimeout(4000);await joy('Fire');await page.waitForTimeout(2000);
    await page.screenshot({path:'/private/tmp/sae-career-before.png'});
  }
  await quit();assert.equal(await page.evaluate(()=>SAER.paused),true);
  await page.getByRole('button',{name:'No, continue playing',exact:true}).click();await page.waitForFunction(()=>!SAER.paused);
  await page.getByRole('button',{name:'Pause game',exact:true}).click();await page.waitForFunction(()=>SAER.paused);
  await quit();await page.getByRole('button',{name:'No, continue playing',exact:true}).click();assert.equal(await page.evaluate(()=>SAER.paused),true);
  await page.getByRole('button',{name:'Resume game',exact:true}).click();await page.waitForFunction(()=>!SAER.paused);
  // Capture a stable hardware digest inside the real UI capture call.
  await page.evaluate(legacy=>{
    const capture=SAEState.capture;SAEState.capture=function(){
      const result=capture();window.beforeState=hardwareDigest();
      if(legacy){
        const events=result.nodes.find(n=>n.anchor==='machine/devices/events');
        result.nodes[events.private.ref].props.push(['is_syncline',2],['is_syncline_end',987654321]);
      }
      return result;
    };
  },!!process.env.STATE_LEGACY_EVENTS);
  await quit();await page.screenshot({path:'/private/tmp/sae-quit.png'});
  const start=Date.now();await page.getByRole('button',{name:'Yes, and save state',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#playerDialog').open||!document.querySelector('#quitError').hidden);
  assert.equal(await page.locator('#quitError').isVisible(),false,await page.locator('#quitError').textContent());
  const expected=await page.evaluate(async()=>{const s=window.beforeState;return {...s,chip:await s.chip,fast:await s.fast}});console.log('Saved in',Date.now()-start,'ms');
  await library();
  if(process.env.STATE_CHANGED_BUILD)await page.evaluate(()=>{SAEStateGlobals.build+='-changed-build-test';});
  await page.evaluate(()=>{
    // Observe the restore boundary before the first guest instruction.
    const queue=SAEState.queue;SAEState.queue=function(state,done,failed){queue(state,()=>{
      window.afterState=hardwareDigest();done();
    },failed);};
  });
  await play();
  await page.locator('#resumeDialog').waitFor({state:'visible'});
  if(process.env.STATE_CHANGED_BUILD)assert.match(await page.locator('#resumeDetail').textContent(),/emulator has changed/);
  await page.getByRole('button',{name:process.env.STATE_CHANGED_BUILD?'Try restoring':'Continue playing',exact:true}).click();await page.waitForFunction(()=>window.afterState||!document.querySelector('#notice').hidden);assert.ok(await page.evaluate(()=>!!window.afterState),await page.locator('#noticeText').textContent());
  const actual=await page.evaluate(async()=>{const s=window.afterState;return {...s,chip:await s.chip,fast:await s.fast}});
  assert.deepEqual(actual,expected,'CPU, clocks and all chip/fast RAM must match before the first resumed instruction');
  await page.waitForTimeout(3000);assert.equal(await page.evaluate(()=>SAER.running&&!SAER.paused),true);
  assert.ok(await page.evaluate(cycle=>SAEV_Events_currcycle>cycle,expected.cycle));
  await page.screenshot({path:'/private/tmp/sae-restored.png'});
  // Restored disk handles must call the new session, not closures from the old page.
  const marker=[83,84,65,84,69,79,75,33];
  await page.evaluate(marker=>{
    const disk=SAER.gayle._saeState.get().idedrive[0].hdhfd.hfd.handle.zf;
    SAEF_ZFile_fseek(disk,disk.size-marker.length,0);SAEF_ZFile_fwrite(new Uint8Array(marker),0,1,marker.length,disk);
  },marker);
  await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent==='Disk changes saved');
  assert.deepEqual(await page.evaluate(()=>Array.from(SAEV_config.mount.config[0].ci.file.data.slice(-8))),marker);
  if(process.env.STATE_CAREER){await joy('Down');await page.waitForTimeout(1000);await page.screenshot({path:'/private/tmp/sae-career-input.png'});}

  await quit();await page.getByRole('button',{name:"Yes and don't save state",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playerDialog').open);
  await play();await page.getByRole('button',{name:'Start normally',exact:true}).click();await page.waitForFunction(()=>SAER.running);await quit();await page.getByRole('button',{name:"Yes and don't save state",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playerDialog').open);
  if(!process.env.STATE_CAREER){
    // A failed replacement must keep both the running game and the old checkpoint.
    await play();await page.getByRole('button',{name:'Start normally',exact:true}).click();await page.waitForFunction(()=>SAER.running&&SAEState.ready);
    const revision=await page.evaluate(async()=>{
      const store=await SAESaves.open(),proto=Object.getPrototypeOf(store);window.originalStateWrite=proto.saveState;
      proto.saveState=async()=>{throw new Error('Test quota exceeded');};
      const records=await new Promise(resolve=>{const r=store.db.transaction('states').objectStore('states').getAll();r.onsuccess=()=>resolve(r.result);});return records[0].revision;
    });
    await quit();await page.getByRole('button',{name:'Yes, and save state',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#quitError').hidden);
    assert.match(await page.locator('#quitError').textContent(),/quota/);assert.equal(await page.evaluate(()=>SAER.running&&SAER.paused),true);
    await page.evaluate(async revision=>{const store=await SAESaves.open();Object.getPrototypeOf(store).saveState=window.originalStateWrite;const records=await new Promise(resolve=>{const r=store.db.transaction('states').objectStore('states').getAll();r.onsuccess=()=>resolve(r.result);});if(records[0].revision!==revision)throw Error('Failed save replaced checkpoint');},revision);
    await page.getByRole('button',{name:'No, continue playing',exact:true}).click();await page.waitForFunction(()=>!SAER.paused);
    await quit();await page.getByRole('button',{name:"Yes and don't save state",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playerDialog').open);
    // A damaged checkpoint must not roll normal disk saves back during a failed launch.
    const diskHashes=await page.evaluate(async()=>{
      const store=await SAESaves.open(),records=await new Promise(resolve=>{const r=store.db.transaction('states').objectStore('states').getAll();r.onsuccess=()=>resolve(r.result);});
      const record=records[0];window.corruptGameId=record.gameId;
      const hashes=(await store.list(record.gameId)).map(r=>r.hash);
      await store.saveState({...record,machine:{...record.machine,hash:'0'.repeat(64)}},record.revision);return hashes;
    });
    await play();await page.getByRole('button',{name:process.env.STATE_CHANGED_BUILD?'Try restoring':'Continue playing',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#noticeText').textContent.includes('damaged')&&!document.querySelector('#playerDialog').open);
    assert.deepEqual(await page.evaluate(async()=>(await(await SAESaves.open()).list(window.corruptGameId)).map(r=>r.hash)),diskHashes);
    await page.getByRole('button',{name:'Settings for '+title,exact:true}).click();await page.locator('#gameSaves summary').click();
    await page.waitForFunction(()=>!document.querySelector('#deleteState').disabled);
    page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Delete saved position',exact:true}).click();assert.equal(await page.locator('#deleteState').isDisabled(),false);
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete saved position',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#deleteState').disabled);
    assert.equal(await page.locator('#deleteSaves').isDisabled(),false,'ordinary disk saves remain');
    await page.getByRole('button',{name:'Close settings',exact:true}).click();await play();await page.waitForFunction(()=>SAER.running&&SAEState.ready);assert.equal(await page.locator('#resumeDialog').isVisible(),false);
    await quit();await page.getByRole('button',{name:"Yes and don't save state",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playerDialog').open);
    // Snapshot writes also reject stale revisions, and game deletion covers both stores.
    await page.evaluate(async()=>{
      const store=await SAESaves.open();await store.saveState({gameId:'isolated',updatedAt:1},0);let rejected=false;
      try{await store.saveState({gameId:'isolated',updatedAt:2},0);}catch{rejected=true;}if(!rejected||(await store.state('isolated')).updatedAt!==1)throw Error('Stale checkpoint replaced the winner');
      await store.saveState({gameId:'keep',updatedAt:1},0);await store.clearGame('isolated');if(await store.state('isolated')||!await store.state('keep'))throw Error('Deletion isolation failed');
    });
  }
  assert.deepEqual(errors,[]);console.log('PASS quit choices, pause preservation, persistent checkpoint, exact CPU/RAM restore after reload, running continuation, disk writes, normal launch, failure recovery and checkpoint deletion');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
