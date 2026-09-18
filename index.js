/* A single local-first launcher for every supported game format. GPL-2.0-or-later. */
(function() {
  'use strict';
  const $=id=>document.getElementById(id), icon=name=>'<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';
  const emulator=new ScriptedAmigaEmulator();
  let files=[], games=[], system={roms:[],runtimes:[],support:{entries:[]},warnings:[]}, view='all', scanning=false, settingsGame=null;
  let saveStorePromise=null;
  function saveStore(){if(!saveStorePromise)saveStorePromise=SAESaves.open().catch(error=>{saveStorePromise=null;throw error;});return saveStorePromise;}
  let current=null, launchToken=0, scanToken=0, importRole='', savedHandle=null, toastTimer;
  const history=readStorage('sae.library.history',{}), favorites=new Set(readStorage('sae.library.favorites',[]));
  let preferences=readStorage('sae.launcher.settings',{}), gamePreferences=readStorage('sae.launcher.games',{});
  function readStorage(key,fallback) {try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}}
  function save(key,value) {try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
  function toast(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
  function settings(game) {return {...SAESystem.defaults,...preferences,...(game?gamePreferences[game.id]:{})};}
  function notice(title,message,action='Add system files') {
    $('noticeAction').onclick=action==='Choose folder'?()=>connectFolder():addSystemFiles;$('noticeTitle').textContent=title;$('noticeText').textContent=message;$('noticeAction').textContent=action;$('noticeAction').hidden=!action;$('notice').hidden=false;
  }
  function status(message) {$('libraryStatus').textContent=message;}
  function setScanning(value) {
    scanning=value;$('refreshLibrary').disabled=value;$('addGames').disabled=value;
    document.querySelectorAll('.play-button').forEach(button=>button.disabled=value);
  }
  function describeTime(time) {
    if(!time)return 'Not played yet';
    const days=Math.floor((Date.now()-time)/86400000);
    return days===0?'Played today':days===1?'Played yesterday':'Played '+days+' days ago';
  }
  function render() {
    const query=$('search').value.trim().toLowerCase();
    let list=games.filter(game=>(view!=='favorites'||favorites.has(game.id))&&(view!=='recent'||history[game.id])&&game.title.toLowerCase().includes(query));
    if($('sort').value==='recent'||view==='recent')list.sort((a,b)=>(history[b.id]||0)-(history[a.id]||0)||a.title.localeCompare(b.title));
    $('gameCount').textContent=list.length;$('navCount').textContent=games.length;
    $('libraryTitle').firstChild.textContent=view==='favorites'?'Favorites ':view==='recent'?'Recently played ':'Library ';
    const grid=$('gameGrid');grid.replaceChildren();
    
    for(const game of list) {
      const card=document.createElement('article');card.className='game-card';card.dataset.game=game.id;
      card.innerHTML='<div class="game-art"><span class="art-title"></span><button class="icon-button favorite-button">'+icon('heart')+'</button></div><div class="game-content"><div class="game-title-row"><h3 class="game-title"></h3><button class="icon-button game-options">'+icon('settings')+'</button></div><p class="game-subtitle"><span class="status-light"></span><span></span></p><div class="game-bottom"><span></span><button class="play-button">'+icon('play')+'Play</button></div></div>';
      card.querySelector('.art-title').textContent=game.title.replace(/[^A-Za-z0-9]/g,'').slice(0,2).toUpperCase();card.querySelector('.game-title').textContent=game.title;
      const subtitle=card.querySelector('.game-subtitle span:last-child');
      subtitle.textContent=game.error?'Needs attention':system.roms.length?(game.kind==='disks'?game.files.length+' disks':'Ready to play'):'Add system files to play';
      card.querySelector('.game-bottom>span').textContent=describeTime(history[game.id]);
      const favorite=card.querySelector('.favorite-button');favorite.setAttribute('aria-pressed',favorites.has(game.id));favorite.setAttribute('aria-label',(favorites.has(game.id)?'Remove ':'Add ')+game.title+(favorites.has(game.id)?' from favorites':' to favorites'));
      favorite.onclick=()=>{if(favorites.has(game.id))favorites.delete(game.id);else favorites.add(game.id);save('sae.library.favorites',[...favorites]);render();};
      const options=card.querySelector('.game-options');options.setAttribute('aria-label','Settings for '+game.title);options.onclick=()=>openSettings(game);
      const play=card.querySelector('.play-button');play.setAttribute('aria-label','Play '+game.title);play.disabled=scanning;play.onclick=()=>playGame(game);
      grid.appendChild(card);
    }
    $('emptyState').hidden=!!list.length;
    if(query) {$('emptyTitle').textContent='No games found.';$('emptyText').textContent='Try another name or clear your search.';}
    else if(view==='favorites') {$('emptyTitle').textContent='No favorites yet.';$('emptyText').textContent='Tap the heart on a game to save it here.';}
    else if(view==='recent') {$('emptyTitle').textContent='No recent games.';$('emptyText').textContent='Played games appear here.';}
    else {$('emptyTitle').textContent=scanning?'Scanning folders…':'No games yet.';$('emptyText').textContent=scanning?'Checking games and BIOS.':'Add a folder containing your games and BIOS.';}
    $('emptyAdd').hidden=scanning||!!query||view!=='all';
    const ready=system.roms.length>0;
    $('systemLight').classList.toggle('warning',!ready);$('systemStatus').textContent=scanning?'Checking system files…':ready?'System files ready':'Add your system files';
    $('machineLabel').textContent='Amiga '+settings().model.replace(/^A/,'');
    
    status(scanning?'Finding your games.':list.length+' games in this view.');
  }
  async function installFiles(next,sourceLabel,replaceServer=false) {
    if(current)return;
    const token=++scanToken;setScanning(true);
    const merged=new Map((replaceServer?files.filter(f=>!f.server):files).map(f=>[f.path,f]));
    for(const file of next)merged.set(file.path,file);
    files=[...merged.values()];const library=SAELibrary.group(files);games=library.games;render();
    try {
      const scanned=await SAESystem.scan(library.system,emulator);
      if(token!==scanToken)return;system=scanned;
      $('librarySource').textContent=sourceLabel;
      if(games.length&&!system.roms.length)notice('Kickstart ROM needed.','Add a Kickstart ROM to bios/ or choose a file.');
      else if(system.roms.length)$('notice').hidden=true;
    } catch(error) {notice('We couldn’t finish scanning.',error.message,'Choose folder');}
    finally {if(token===scanToken){setScanning(false);render();}}
  }
  async function refresh() {
    if(current||scanning)return;
    setScanning(true);render();
    try {
      const discovered=await SAELibrary.discover();discovered.forEach(f=>f.server=true);
      setScanning(false);await installFiles(discovered,discovered.length?'Connected to games/ and bios/':'Choose a folder to connect your library',true);
    } catch(error) {setScanning(false);render();$('librarySource').textContent='Choose a folder to connect your library';notice('Choose a library folder.','Choose your library folder, or start the launcher with python3 serve.py.','Choose folder');}
  }
  function addDialog() {$('addDialog').showModal();}
  async function importFiles(list,role='') {
    if(!list.length)return;
    const incoming=Array.from(list).map(file=>SAELibrary.source(file,role));
    if($('addDialog').open)$('addDialog').close();
    await installFiles(incoming,'Connected to your selected files');
  }
  // Store a folder handle, not a copy of every game. Browsers may require reconnecting after restart.
  function handleDB(write,value) {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('sae-library',1);request.onupgradeneeded=()=>request.result.createObjectStore('folders');request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result, tx=db.transaction('folders',write?'readwrite':'readonly'), store=tx.objectStore('folders');const operation=write?store.put(value,'library'):store.get('library');let result;
        operation.onsuccess=()=>result=operation.result;tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};};
    });
  }
  async function readFolder(handle,prefix='',result=[]) {
    if(prefix.split('/').length>16)throw new Error('This folder has too many nested folders. Choose a smaller collection.');
    for await(const [name,entry] of handle.entries()) {
      if(name.startsWith('.'))continue;
      if(result.length>=10000)throw new Error('Choose a folder with fewer than 10,000 files.');
      if(entry.kind==='directory')await readFolder(entry,prefix+name+'/',result);
      else {const file=await entry.getFile();result.push(SAELibrary.source(file,prefix));}
    }
    return result;
  }
  async function connectFolder(reconnect=false) {
    if(!window.showDirectoryPicker){$('folderInput').click();return;}
    try {
      const handle=reconnect?savedHandle:await showDirectoryPicker({id:'sae-library',mode:'read'});
      if(!handle)return;
      if(reconnect&&await handle.requestPermission({mode:'read'})!=='granted')return;
      $('addDialog').close();const next=await readFolder(handle,handle.name+'/');
      await installFiles(next,'Connected to '+handle.name);savedHandle=handle;
      try{await handleDB(true,handle);$('reconnectFolder').hidden=false;}catch{}
    } catch(error){if(error.name!=='AbortError')toast(error.message);}
  }
  function fillForm(values) {
    for(const [name,value] of Object.entries(values)) {
      const input=$('settingsForm').elements.namedItem(name);if(!input)continue;
      if(input.type==='checkbox')input.checked=!!value;else input.value=String(value);
    }
  }
  function populateSystemOptions() {
    for(const [name,items] of [['rom',system.roms],['runtime',system.runtimes]]) {
      const select=$('settingsForm').elements.namedItem(name);select.replaceChildren(new Option('Choose automatically','auto'));
      for(const item of items)select.add(new Option(item.info?item.name+' · '+item.info.models:item.path,item.path));
    }
    const summary=$('biosSummary');summary.replaceChildren();
    const descriptions=[system.roms.length+' Kickstart ROM'+(system.roms.length===1?'':'s')+' found',system.runtimes.length?'WHDLoad ready':'WHDLoad not found — needed for installed games',system.support.entries.filter(e=>/\.rtb$/i.test(e.name)).length+' Kickstart support files'];
    for(const text of [...descriptions,...system.warnings]){const line=document.createElement('div');line.textContent=text;summary.appendChild(line);}
  }
  async function metadata(game) {
    if(!game.metadata)game.metadata=await SAELibrary.inspect(game);
    return game.metadata;
  }
  async function openSettings(game=null) {
    if(current)return;
    settingsGame=game;populateSystemOptions();
    $('settingsTitle').textContent=game?game.title:'Launcher settings';
    $('settingsDescription').textContent=game?'Settings for this game.':'Defaults for all games.';
    $('gameSaves').hidden=!game;if(game)updateSaveSummary(game);
    $('gameVariants').hidden=true;fillForm(settings(game));$('settingsDialog').showModal();
    if(game) {
      try {
        const meta=await metadata(game);if(settingsGame!==game||!$('settingsDialog').open)return;
        const select=$('settingsForm').elements.namedItem('variant');select.replaceChildren(new Option('Choose automatically',''));
        for(const entry of meta.variants)select.add(new Option(entry.name,entry.name));
        select.value=settings(game).variant||'';$('gameVariants').hidden=false;
        $('gameFileDetail').textContent=meta.type==='whdload'?'WHDLoad':meta.type==='floppy'?meta.variants.length+' disk image(s). Switch disks while playing.':'Hard drive image.';
      }catch(error){toast(error.message);}
    }
  }
  $('settingsForm').addEventListener('submit',event=>{
    event.preventDefault();const value={};
    for(const key of Object.keys(SAESystem.defaults)){const input=$('settingsForm').elements.namedItem(key);if(input)value[key]=input.type==='checkbox'?input.checked:input.value;}
    if(settingsGame){gamePreferences[settingsGame.id]=value;save('sae.launcher.games',gamePreferences);}
    else{delete value.variant;preferences=value;save('sae.launcher.settings',preferences);}
    $('settingsDialog').close();render();toast('Settings saved.');
  });
  $('resetSettings').onclick=()=>{if(settingsGame){fillForm({...SAESystem.defaults,...preferences});}else fillForm(SAESystem.defaults);};
  async function playGame(game) {
    if(current||scanning)return;
    const token=++launchToken, options=settings(game);current={game,token,running:false,paused:false,muted:!options.sound,options,disks:[]};
    $('stopGame').disabled=false;$('saveRecovery').hidden=true;$('saveStatus').textContent='Saves stored in this browser';
    $('playingTitle').textContent=game.title;$('playerError').hidden=true;$('bootMessage').hidden=false;$('bootText').textContent='Getting '+game.title+' ready…';
    $('mouseHint').textContent=options.mouseLock?'Click game to capture mouse · Esc to release':'Mouse capture off';
    $('diskControl').hidden=true;$('pauseGame').setAttribute('aria-pressed','false');$('pauseGame').setAttribute('aria-label','Pause game');$('pauseGame').title='Pause';$('pauseGame').innerHTML=icon('pause');$('muteGame').setAttribute('aria-pressed',String(!options.sound));
    $('playerDialog').showModal();$('screenWrap').className='screen-wrap '+options.picture;
    $('playerMachine').textContent='Amiga '+options.model.slice(1);$('controlHint').textContent=options.controller==='gamepad'?'Use your connected gamepad':(options.movement==='wasd'?'W A S D':'Arrow keys')+' to move · '+({ShiftRight:'Right Shift',ControlRight:'Right Ctrl',Space:'Space'}[options.fire])+' to fire';
    const active=current;
    try {
      const release=await SAESaves.lock(game.id);
      if(token!==launchToken){release();return;}active.release=release;
      active.saves=new SAESaves.Session(await saveStore(),game.id,(state,detail)=>saveStatus(active,state,detail));
      const checkpoint=await(await saveStore()).state(game.id);active.stateRevision=checkpoint?.revision||0;
      if(token!==launchToken){active.saves.close();return;}
      const meta=await metadata(game);if(token!==launchToken)return;
      const rom=SAELibrary.chooseRom(system.roms,options.model,options.rom);
      if(!rom)throw new Error(options.rom==='auto'?'No suitable Kickstart ROM for '+options.model+'. Add a Kickstart 3.1 ROM to bios/ for the default A1200.':'The selected Kickstart ROM is missing. Choose another ROM in game settings.');
      let hardfile=null, floppy=[];
      const selected=meta.variants.find(e=>e.name===options.variant)||meta.variants[0];
      if(meta.type==='whdload') {
        const runtime=options.runtime==='auto'?system.runtimes[0]:system.runtimes.find(r=>r.path===options.runtime);
        if(!runtime)throw new Error('This installed game needs WHDLoad. Add WHDLoad_usr.lha to bios/ or use Add system files.');
        if(rom.info&&rom.info.subVer<37)throw new Error('This game needs Kickstart 2.0 or newer. Choose A1200 with a 3.1 ROM in game settings.');
        hardfile={name:game.title+'.hdf',data:await SAEF_WHDLoad.prepare(meta.archive,selected.name,runtime.data,system.support)};
      } else if(meta.type==='hardfile')hardfile=await SAELibrary.image(selected);
      else {
        // Keep the whole disk set for swapping; preload up to four drives only when requested.
        current.disks=meta.variants;current.diskIndex=meta.variants.indexOf(selected);
        const entries=options.multiDrive?[selected,...meta.variants.filter(e=>e!==selected)].slice(0,4):[selected];
        for(const entry of entries)floppy.push(await SAELibrary.image(entry));
      }
      if(token!==launchToken)return;
      const sourceMedia=hardfile?[await SAESaves.hash(hardfile.data)]:await Promise.all(meta.variants.map(async entry=>SAESaves.hash((await SAELibrary.image(entry)).data)));
      active.identity=JSON.stringify({options,sourceMedia,rom:await SAESaves.hash(rom.data),build:SAEStateGlobals.build,version:SAEState.VERSION});
      let resume=null;
      if(checkpoint){
        const compatible=checkpoint.identity===active.identity;
        const decision=await chooseResume(checkpoint,compatible);
        if(decision==='cancel'){await finishPlayer(token);return;}
        if(decision==='resume')resume=checkpoint;
      }
      if(resume){
        await active.saves.stageCheckpoint(resume.media);
        if(floppy.length){
          if(!Number.isInteger(resume.diskIndex)||!meta.variants[resume.diskIndex])throw new Error('The saved disk selection is missing.');
          floppy[0]=await SAELibrary.image(meta.variants[resume.diskIndex]);active.diskIndex=resume.diskIndex;
        }
      }
      if(hardfile)hardfile=await active.saves.mount(hardfile,'hardfile:'+selected.name,options.readonly,resume?.media);
      floppy=await Promise.all(floppy.map(disk=>active.saves.mount(disk,'floppy:'+disk.name,options.readonly,resume?.media)));
      if(token!==launchToken)return;
      const cfg=SAESystem.configure(emulator,options,rom,system.key);
      if(hardfile){SAESystem.mount(cfg,hardfile.name,hardfile.data,options.readonly);SAESystem.attachMedia(cfg.mount.config[0].ci.file,hardfile);}
      for(let i=0;i<floppy.length;i++) {cfg.floppy.drive[i].type=SAEC_Config_Floppy_Type_35_DD;SAESystem.attachMedia(cfg.floppy.drive[i].file,floppy[i]);cfg.floppy.drive[i].file.prot=options.readonly;}
      cfg.hook.log.error=(code,message)=>{if(token===launchToken){$('playerError').hidden=false;$('playerError').textContent=message||'The emulator reported error '+code+'. Try another Amiga model in game settings.';}};
      cfg.hook.event.started=()=>{
        if(token!==launchToken)return;current.running=true;$('bootMessage').hidden=true;$('myVideo').focus();
        history[game.id]=Date.now();save('sae.library.history',history);game.error=null;
        if(current.disks.length>1){const select=$('diskSelect');select.replaceChildren();current.disks.forEach((disk,i)=>select.add(new Option(disk.name,String(i))));select.value=String(current.diskIndex);$('diskControl').hidden=false;}
      };
      cfg.hook.event.stopped=()=>{active.running=false;finishPlayer(token);};
      cfg.hook.event.paused=paused=>{if(!current)return;paused=!!paused;current.paused=paused;$('pauseGame').setAttribute('aria-pressed',String(paused));$('pauseGame').setAttribute('aria-label',paused?'Resume game':'Pause game');$('pauseGame').title=paused?'Resume':'Pause';$('pauseGame').innerHTML=icon(paused?'play':'pause');};
      SAEState.begin();
      if(resume)SAEState.queue(await SAECheckpoint.unpack(resume.machine),()=>{
        active.saves.adoptCheckpoint();active.saves.flush().catch(()=>{});
      },error=>{game.error=error.message;notice('Couldn’t restore '+game.title+'.',error.message,'');});
      const error=emulator.start();if(error!==SAEE_None)throw new Error('Couldn’t start this game (code '+error+'). Check the ROM or try another Amiga model in game settings.');
    } catch(error) {
      if(token!==launchToken)return;
      SAEState.cancel();game.error=error.message;
      if(current?.running)stopGame();else finishPlayer(token);
      notice('Couldn’t start '+game.title+'.',error.message,/ROM|Kickstart|WHDLoad/.test(error.message)?'Add system files':'Game settings');
      $('noticeAction').onclick=()=>/ROM|Kickstart|WHDLoad/.test(error.message)?addSystemFiles():openSettings(game);
    }
  }
  async function finishPlayer(token) {
    if(token!==launchToken||current.finishing)return;
    const active=current;active.finishing=true;$('stopGame').disabled=true;
    try {
      if(active.saves)await active.saves.flush();
      if(token!==launchToken)return;
      active.saves?.close();active.release?.();
      current=null;++launchToken;setExpanded(false);$('playerDialog').close();$('myVideo').replaceChildren();render();
    } catch(error){saveStatus(active,'error',error);}
    finally{active.finishing=false;$('stopGame').disabled=false;}
  }
  function stopGame() {
    if(!current||current.finishing)return;
    if(!current.running){finishPlayer(current.token);return;}
    if(current.paused)emulator.pause(false);
    const error=emulator.stop();if(error!==SAEE_None)finishPlayer(current.token);
  }
  function chooseResume(checkpoint,compatible){
    return new Promise(resolve=>{
      const dialog=$('resumeDialog');
      $('resumeState').disabled=!compatible;
      $('resumeDetail').textContent=compatible?'Saved '+new Date(checkpoint.updatedAt).toLocaleString():'This position uses different settings or emulator files. You can still start normally.';
      const done=value=>{dialog.close();resolve(value);};
      $('resumeState').onclick=()=>done('resume');$('resumeFresh').onclick=()=>done('fresh');$('resumeCancel').onclick=()=>done('cancel');
      dialog.oncancel=event=>{event.preventDefault();done('cancel');};dialog.showModal();
    });
  }
  async function pauseForState(active){
    if(!active.running)throw new Error('The game is not running.');
    const deadline=Date.now()+5000;
    while(active.running&&!SAEState.ready){if(Date.now()>deadline)throw new Error('The game is still starting. Try again.');await new Promise(r=>setTimeout(r,20));}
    if(!emulator.paused)emulator.pause(true);
    while(current===active&&active.running&&!emulator.paused){if(Date.now()>deadline)throw new Error('The game did not pause. Try again.');await new Promise(r=>setTimeout(r,20));}
    if(current!==active||!active.running)throw new Error('The game stopped before it could be saved.');
  }
  function quitBusy(busy){$('quitDialog').setAttribute('aria-busy',String(busy));for(const id of ['quitSave','quitDiscard','quitContinue'])$(id).disabled=busy;}
  async function requestQuit(){
    const active=current;if(!active||active.finishing||$('quitDialog').open)return;
    if(!active.running){stopGame();return;}
    active.wasPaused=active.paused;
    document.exitPointerLock?.();$('quitError').hidden=true;quitBusy(true);$('quitDialog').showModal();
    try{await pauseForState(active);quitBusy(false);$('quitContinue').focus();}
    catch(error){$('quitError').textContent=error.message;$('quitError').hidden=false;quitBusy(false);$('quitSave').disabled=true;}
  }
  function continueGame(){
    if($('quitContinue').disabled)return;
    $('quitDialog').close();if(current?.running&&!current.wasPaused)emulator.pause(false);$('myVideo').focus();
  }
  $('quitDialog').addEventListener('cancel',event=>{event.preventDefault();continueGame();});
  $('quitContinue').onclick=continueGame;
  $('quitDiscard').onclick=()=>{$('quitDialog').close();stopGame();};
  $('quitSave').onclick=async()=>{
    const active=current;if(!active?.running)return;active.savingState=true;quitBusy(true);$('quitError').hidden=true;$('quitSave').textContent='Saving…';
    try{
      await pauseForState(active);await new Promise(r=>setTimeout(r,0));
      const machine=SAEState.capture();
      await active.saves.flush();const media=await active.saves.checkpointMedia();
      await(await saveStore()).saveState({gameId:active.game.id,identity:active.identity,updatedAt:Date.now(),diskIndex:active.diskIndex,machine:await SAECheckpoint.pack(machine),media},active.stateRevision);
      $('quitDialog').close();stopGame();
    }catch(error){$('quitError').textContent='Could not save state: '+error.message;$('quitError').hidden=false;}
    finally{active.savingState=false;quitBusy(false);$('quitSave').textContent='Yes, and save state';}
  };
  $('stopGame').onclick=requestQuit;
  // Escape belongs to mouse capture/fullscreen, never to stopping the game.
  $('playerDialog').addEventListener('cancel',event=>event.preventDefault());
  document.addEventListener('pointerlockchange',()=>{
    if(!current)return;
    const captured=$('myVideo').contains(document.pointerLockElement);
    if(captured)$('myVideo').focus();
    $('mouseHint').textContent=captured?'Mouse captured · Esc to release':current.options.mouseLock?'Click game to capture mouse · Esc to release':'Mouse capture off';
  });
  $('pauseGame').onclick=()=>{if(current?.running&&SAEState.ready)emulator.pause(!current.paused);};
  $('muteGame').onclick=()=>{if(current?.running){current.muted=!current.muted;emulator.mute(current.muted);$('muteGame').setAttribute('aria-pressed',String(current.muted));$('muteGame').setAttribute('aria-label',current.muted?'Unmute sound':'Mute sound');}};
  $('resetGame').onclick=()=>{if(current?.running)emulator.reset(false,false);};
  function setExpanded(expanded) {
    $('playerDialog').classList.toggle('expanded',expanded);
    $('fullscreenGame').setAttribute('aria-pressed',String(expanded));
    $('fullscreenGame').setAttribute('aria-label',expanded?'Restore game size':'Expand game');
    $('fullscreenGame').title=expanded?'Restore size':'Fill browser page';
    $('fullscreenGame').innerHTML=icon(expanded?'collapse':'expand');
  }
  $('fullscreenGame').onclick=()=>setExpanded(!$('playerDialog').classList.contains('expanded'));
  $('diskSelect').onchange=async()=>{
    if(!current?.running)return;const active=current, select=$('diskSelect'), index=Number(select.value);select.disabled=true;
    try{let disk=await SAELibrary.image(active.disks[index]);disk=await active.saves.mount(disk,'floppy:'+disk.name,active.options.readonly);if(current!==active)return;const file=emulator.getConfig().floppy.drive[0].file;SAESystem.attachMedia(file,disk);file.prot=active.options.readonly;const error=emulator.insert(0);if(error!==SAEE_None)throw new Error('Could not insert this disk.');active.diskIndex=index;}
    catch(error){select.value=String(active.diskIndex);$('playerError').hidden=false;$('playerError').textContent=error.message;}
    finally{select.disabled=false;}
  };
  // Keep launcher controls keyboard-accessible while SAE listens for game keys on document.
  for(const dialog of ['playerDialog','quitDialog','resumeDialog'])for(const type of ['keydown','keyup'])$(dialog).addEventListener(type,event=>{if(event.target.closest('button,select'))event.stopPropagation();});
  function saveStatus(active,state,detail) {
    if(current!==active)return;
    $('saveStatus').textContent=state==='restored'?'Saved disk restored':state==='saving'?'Saving…':state==='saved'?'Disk changes saved':state==='error'?'Save failed':'Saves stored in this browser';
    if(state==='error'){
      setExpanded(false);$('playerError').hidden=false;$('saveRecovery').hidden=false;
      $('playerError').textContent='Could not store game saves: '+detail.message+' Retry or export a backup before closing.';
    } else if(state==='saved'){$('saveRecovery').hidden=true;$('playerError').hidden=true;}
  }
  async function updateSaveSummary(game) {
    $('saveSummary').textContent='Checking saves…';
    $('deleteSaves').disabled=true;$('deleteState').disabled=true;
    try{const checkpoint=await(await saveStore()).state(game.id);if(settingsGame!==game)return;
      $('stateSummary').textContent=checkpoint?'Position saved '+new Date(checkpoint.updatedAt).toLocaleString():'No saved position.';
      $('deleteState').disabled=!checkpoint;
      const records=await (await saveStore()).list(game.id);if(settingsGame!==game)return;
      $('saveSummary').textContent=records.length?'Saved '+new Date(Math.max(...records.map(r=>r.updatedAt))).toLocaleString():'No saved disk changes yet.';
      $('deleteSaves').disabled=!records.length&&!checkpoint;
    }catch(error){if(settingsGame===game)$('saveSummary').textContent='Save storage unavailable: '+error.message;}
  }
  async function downloadSaves(records,title) {
    const blob=await SAESaves.exportFile(records,title),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=title.replace(/[^a-z0-9 _-]/gi,'')+'.saesave';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  $('exportSaves').onclick=async()=>{try{const game=settingsGame;await downloadSaves(await(await saveStore()).list(game.id),game.title);}catch(error){toast(error.message);}};
  $('importSaves').onclick=()=>$('saveInput').click();
  $('deleteState').onclick=async()=>{
    const game=settingsGame;if(!game||!confirm('Delete the saved position for '+game.title+'? Disk saves are kept.'))return;
    let release;try{release=await SAESaves.lock(game.id);await(await saveStore()).deleteState(game.id);await updateSaveSummary(game);toast('Saved position deleted.');}catch(error){toast(error.message);}finally{release?.();}
  };
  $('deleteSaves').onclick=async()=>{
    const game=settingsGame;if(!game)return;
    if(!confirm('Delete stored data for '+game.title+'?\n\nThis removes the saved position, all saved progress and crash dumps from this game’s browser-stored disks. Original game files and exported backups are kept.'))return;
    let release;$('deleteSaves').disabled=true;
    try{
      if(current?.game.id===game.id)throw new Error('Close this game before deleting its stored data.');
      release=await SAESaves.lock(game.id);
      await(await saveStore()).clearGame(game.id);
      toast('Stored data deleted. The next launch starts fresh.');
    }catch(error){toast(error.message);}
    finally{release?.();if(settingsGame===game)await updateSaveSummary(game);}
  };
  $('saveInput').onchange=async event=>{
    const file=event.target.files[0],game=settingsGame;event.target.value='';if(!file||!game)return;let release;
    try{release=await SAESaves.lock(game.id);await SAESaves.importFile(file,game.id,await saveStore());await updateSaveSummary(game);toast('Save backup imported.');}
    catch(error){toast(error.message);}finally{release?.();}
  };
  $('retrySave').onclick=async()=>{const active=current;if(!active)return;try{await active.saves.flush();if(!active.running)await finishPlayer(active.token);}catch{}};
  $('exportSession').onclick=async()=>{try{const active=current;if(active)await downloadSaves(await active.saves.records(),active.game.title);}catch(error){toast(error.message);}};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)current?.saves?.flush().catch(()=>{});});
  window.addEventListener('pagehide',()=>{current?.saves?.flush().catch(()=>{});});
  window.addEventListener('beforeunload',event=>{if(current?.saves?.dirty||current?.savingState){event.preventDefault();event.returnValue='';}});
  function addSystemFiles() {importRole='bios/';$('fileInput').click();}
  $('addBios').onclick=()=>{$('settingsDialog').close();addSystemFiles();};
  $('noticeAction').onclick=()=>{if($('noticeAction').textContent==='Choose folder')addDialog();else addSystemFiles();};
  $('dismissNotice').onclick=()=>$('notice').hidden=true;
  $('addGames').onclick=$('emptyAdd').onclick=$('manageLibrary').onclick=addDialog;
  $('chooseFolder').onclick=()=>connectFolder();$('reconnectFolder').onclick=()=>connectFolder(true);
  $('chooseFiles').onclick=()=>{importRole='';$('fileInput').click();};
  $('folderInput').onchange=async event=>{await importFiles(event.target.files);event.target.value='';};
  $('fileInput').onchange=async event=>{await importFiles(event.target.files,importRole);event.target.value='';importRole='';};
  $('openSettings').onclick=()=>openSettings();$('refreshLibrary').onclick=refresh;
  $('search').oninput=render;$('sort').onchange=render;
  for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{
    view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b===button);if(b===button)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});render();
  };
  for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!document.querySelector('dialog[open]')&&!event.target.matches('input,textarea,select')){event.preventDefault();$('search').focus();}});
  let dragDepth=0;
  document.addEventListener('dragenter',event=>{if(!current&&event.dataTransfer?.types.includes('Files')){event.preventDefault();dragDepth++;$('dropOverlay').hidden=false;}});
  document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
  document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('dropOverlay').hidden=true;}});
  document.addEventListener('drop',async event=>{
    event.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;if(current)return;
    const items=Array.from(event.dataTransfer.items||[]), dropped=[];
    async function walk(entry,prefix='') {
      if(!entry||entry.name.startsWith('.'))return;
      if(prefix.split('/').length>16)throw new Error('Choose a folder with fewer nested folders.');
      if(dropped.length>=10000)throw new Error('Choose fewer than 10,000 files.');
      if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));dropped.push(SAELibrary.source(file,prefix));}
      else{const reader=entry.createReader();for(;;){const children=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!children.length)break;for(const child of children)await walk(child,prefix+entry.name+'/');}}
    }
    try{for(const item of items){const entry=item.webkitGetAsEntry?.();if(entry)await walk(entry);else{const file=item.getAsFile();if(file)dropped.push(SAELibrary.source(file));}}await installFiles(dropped,'Connected to your dropped files');}catch(error){toast(error.message);}
  });
  
  render();
  (async()=>{
    await refresh();
    try{savedHandle=await handleDB(false);if(savedHandle){$('reconnectFolder').hidden=false;if(await savedHandle.queryPermission({mode:'read'})==='granted'){const restored=await readFolder(savedHandle,savedHandle.name+'/');await installFiles(restored,'Connected to '+savedHandle.name);}}}catch{}
  })();
})();
