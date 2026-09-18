// Optional integration: use the same Playwright/Chromium setup as state.browser.cjs.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const port=process.env.AUDIO_PORT||'18787';
 const server=spawn('python3',['-u','serve.py','--port',port],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)));});server.stdout.on('data',()=>{});server.stderr.on('data',()=>{});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--autoplay-policy=no-user-gesture-required']});
  for(const mode of (process.env.AUDIO_MODES||'worklet,mono,missing,failed,late').split(',')){
   const page=await browser.newPage(),errors=[],warnings=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>{errors.push(e.message);console.error(mode,e.message);});page.on('console',m=>{if(/deprecated/i.test(m.text()))warnings.push(m.text());});
   await page.addInitScript(mode=>{
    window.audioTest={contexts:[],nodes:[],legacy:0};
    const NativeContext=window.AudioContext;
    window.AudioContext=class extends NativeContext{constructor(...args){
     super(...args);audioTest.contexts.push(this);
     const addModule=this.audioWorklet.addModule.bind(this.audioWorklet);
     if(mode==='failed')this.audioWorklet.addModule=()=>addModule('/missing-audio-worklet.js');
     if(mode==='late')this.audioWorklet.addModule=url=>addModule(url).then(()=>new Promise(resolve=>window.releaseAudioModule=resolve));
    }};
    window.webkitAudioContext=window.AudioContext;
    const create=NativeContext.prototype.createScriptProcessor;
    NativeContext.prototype.createScriptProcessor=function(...args){++audioTest.legacy;return create.apply(this,args);};
    const NativeNode=window.AudioWorkletNode;
    window.AudioWorkletNode=mode==='missing'?undefined:class extends NativeNode{
     constructor(...args){super(...args);this.outputChannels=args[2].outputChannelCount[0];audioTest.nodes.push(this);this.analyser=args[0].createAnalyser();this.connect(this.analyser);}
    };
    window.audioPeak=()=>{const node=audioTest.nodes.at(-1);if(!node)return -1;const samples=new Float32Array(node.analyser.fftSize);node.analyser.getFloatTimeDomainData(samples);return samples.reduce((peak,v)=>Math.max(peak,Math.abs(v)),0);};
    if(mode==='mono')localStorage.setItem('sae.launcher.settings',JSON.stringify({stereo:false}));
   },mode);
   await page.goto('http://127.0.0.1:'+port+'/');await page.getByRole('button',{name:'Play Qwak',exact:true}).click();await page.waitForFunction(()=>SAER.running&&SAEState.ready);
   async function quit(){await page.getByRole('button',{name:'Back to library',exact:true}).click();await page.getByRole('button',{name:"Yes and don't save state",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playerDialog').open);}
   if(mode==='worklet'||mode==='mono'){
    await page.waitForFunction(()=>audioTest.nodes.length===1);assert.equal(await page.evaluate(()=>audioTest.legacy),0);
    assert.equal(await page.evaluate(()=>audioTest.nodes[0].outputChannels),mode==='mono'?1:2);
    assert.equal(await page.evaluate(()=>audioTest.nodes[0].numberOfInputs),0);
    await page.waitForFunction(()=>audioPeak()>0.001,{},{timeout:60000});
    await page.getByRole('button',{name:'Pause game',exact:true}).click();await page.waitForFunction(()=>SAER.paused);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>audioPeak()),0);
    await page.getByRole('button',{name:'Resume game',exact:true}).click();await page.waitForFunction(()=>audioPeak()>0.001);
    await page.getByRole('button',{name:'Mute sound',exact:true}).click();await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>audioPeak()),0);
    await page.locator('#muteGame').click();await page.waitForFunction(()=>audioPeak()>0.001);
    assert.deepEqual(warnings,[]);await quit();await page.waitForFunction(()=>audioTest.contexts.every(c=>c.state==='closed'));
    await page.getByRole('button',{name:'Play Qwak',exact:true}).click();await page.waitForFunction(()=>audioTest.nodes.length===2&&SAER.running&&SAEState.ready);assert.equal(await page.evaluate(()=>audioTest.contexts[1].state),'running');await quit();
   }else if(mode==='late'){
    await page.waitForFunction(()=>!!window.releaseAudioModule);await quit();await page.evaluate(()=>releaseAudioModule());await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>audioTest.nodes.length+audioTest.legacy),0);
   }else{await page.waitForFunction(()=>audioTest.legacy===1);await quit();}
   await page.waitForFunction(()=>audioTest.contexts.every(c=>c.state==='closed'));assert.deepEqual(errors,[]);console.log('PASS audio',mode);await page.close();
  }
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
