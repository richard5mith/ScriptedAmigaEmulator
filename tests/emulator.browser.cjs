// Optional real-game regression: local Qwak.zip, BIOS, Python and Playwright.
// Uses a fresh browser profile; existing browser saves are never touched.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
 const server = spawn(process.env.PYTHON || 'python3',['-u','serve.py','--port','18783'],
  {cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});
 let browser, page;
 try {
  let serverErrors = '';
  server.stderr.on('data',data=>{serverErrors += data;});
  await new Promise((resolve,reject)=>{
   server.stdout.once('data',resolve);server.once('error',reject);
   server.once('exit',code=>reject(Error(`Server exited ${code}: ${serverErrors}`)));
  });
  server.stdout.on('data',()=>{});
  browser = await chromium.launch({headless:true,
   ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),
   args:['--autoplay-policy=no-user-gesture-required']});
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:18783/');
  const play = page.getByRole('button',{name:'Play Qwak',exact:true});
  await play.waitFor();await page.waitForFunction(()=>!document.querySelector('.play-button').disabled);
  await page.evaluate(()=>{SAEF_sleep = () => {throw Error('Emulation attempted a busy wait');};});
  await play.click();await page.waitForFunction(()=>document.querySelector('#bootMessage').hidden);
  await page.waitForFunction(()=>SAEV_Events_timeframes > 300 && SAER.running && !SAER.m68k.halted);
  console.log('Qwak booted');
  const before = await page.evaluate(()=>({frames:SAEV_Events_timeframes,time:performance.now()}));
  await page.waitForFunction(frames=>SAEV_Events_timeframes >= frames + 100,before.frames);
  const after = await page.evaluate(()=>({frames:SAEV_Events_timeframes,time:performance.now()}));
  const fps = (after.frames-before.frames)*1000/(after.time-before.time);
  console.log('Measured fps',fps);
  assert.ok(fps > 40 && fps < 60,`Expected PAL cadence, got ${fps.toFixed(1)} fps`);
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(()=>!!(SAER.input._saeState.get().joydir[1] & 1));
  await page.evaluate(()=>{for(let i=0;i<1000;i++)SAER.input.registerEvent(0,20,1,-1);});
  await page.keyboard.up('ArrowLeft');
  await page.waitForFunction(()=>SAER.input._saeState.get().joydir[1] === 0);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(()=>!!(SAER.input._saeState.get().joydir[1] & 2));
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(()=>SAER.input._saeState.get().joydir[1] === 0);
  await page.keyboard.up('ArrowRight');
  await page.getByRole('button',{name:'Back to library',exact:true}).click();
  await page.waitForFunction(()=>SAER.paused);
  const captured = await page.evaluate(()=>SAEV_Events_timeframes);
  await page.getByRole('button',{name:'Yes, and save state',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#playerDialog').open,{},{timeout:60000});
  console.log('Saved frame',captured);
  await play.click();await page.getByRole('button',{name:'Continue playing',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#bootMessage').hidden);
  console.log('Restore started',await page.evaluate(()=>({frames:SAEV_Events_timeframes,running:SAER.running,paused:SAER.paused,halted:SAER.m68k.halted})));
  await page.waitForFunction(frames=>SAER.running && !SAER.paused && !SAER.m68k.halted && SAEV_Events_timeframes > frames + 30,captured);
  assert.deepEqual(errors,[]);
  console.log(`PASS Qwak boot, ${fps.toFixed(1)} fps, no busy waits, input releases, checkpoint capture/restore`);
 } catch (error) {
  if (page) console.error('Browser state',await page.evaluate(()=>({text:document.body.innerText.slice(-4000),frames:typeof SAEV_Events_timeframes !== 'undefined' ? SAEV_Events_timeframes : null,running:SAER?.running,paused:SAER?.paused,halted:SAER?.m68k?.halted,command:SAEV_command,flags:SAEV_spcflags})).catch(()=>null));
  throw error;
 } finally {
  if (browser) await browser.close();
  server.kill();
 }
})().catch(error=>{console.error(error);process.exitCode = 1;});
