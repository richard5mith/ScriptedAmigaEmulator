// Optional: same Playwright/Chromium environment as state.browser.cjs.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const server=spawn('python3',['-u','serve.py','--port','18786'],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});let browser;
 try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)));});server.stdout.on('data',()=>{});server.stderr.on('data',()=>{});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18786/');
  // Real GPU compile, scanline/mask contrast, orientation and an uncropped flat border.
  const result=await page.evaluate(async()=>{
   const host=document.createElement('div');host.style.cssText='position:relative;width:720px;height:568px';document.body.append(host);
   const src=document.createElement('canvas');src.width=720;src.height=568;host.append(src);const ctx=src.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,720,568);ctx.fillStyle='#ff0000';ctx.fillRect(0,0,720,150);ctx.fillStyle='#0000ff';ctx.fillRect(0,420,720,148);
   let failed=false;const filter=SAECRT.attach(host,()=>failed=true);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const canvas=host.querySelector('.crt-display'),gl=canvas.getContext('webgl'),pixel=(x,y)=>{const p=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
   const result={failed,corner:pixel(4,280),top:pixel(360,500),bottom:pixel(360,60),center:pixel(360,280),mask:pixel(361,280),line:pixel(360,281),error:gl.getError(),hidden:src.classList.contains('crt-source')};
   gl.getExtension('WEBGL_lose_context').loseContext();await new Promise(r=>setTimeout(r,100));result.fallback=failed&&!src.classList.contains('crt-source')&&!host.querySelector('.crt-display');filter.destroy();host.remove();return result;
  });
  assert.equal(result.failed,false);assert.equal(result.error,0);assert.ok(result.hidden);assert.ok(result.corner[0]>0,'flat picture must extend to the side border');assert.ok(result.top[0]>result.top[2]*2);assert.ok(result.bottom[2]>result.bottom[0]*2);assert.notDeepEqual(result.center,result.mask);assert.notDeepEqual(result.center,result.line);assert.ok(result.fallback);console.log('Shader pixels, orientation, mask, scanlines and context-loss fallback passed');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator('summary').filter({hasText:'Display & sound'}).click();
  await page.locator('select[name="picture"]').selectOption('crt');await page.locator('select[name="renderer"]').selectOption('canvas');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.reload();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sae.launcher.settings')).picture),'crt');
  await page.getByRole('button',{name:'Play Qwak',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.crt-source'));await page.waitForTimeout(15000);
  await page.screenshot({path:'/private/tmp/sae-crt-window.png'});
  await page.getByRole('button',{name:'Pause game',exact:true}).click();await page.waitForFunction(()=>SAER.paused);
  await page.getByRole('button',{name:'Expand game',exact:true}).click();await page.waitForTimeout(300);
  await page.screenshot({path:'/private/tmp/sae-crt-expanded.png'});
  assert.ok(await page.evaluate(()=>{const r=document.querySelector('.crt-display').getBoundingClientRect();return r.width>720&&Math.abs(r.width/r.height-720/568)<0.01;}));
  assert.equal(await page.locator('.crt-display').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
  await page.locator('#fullscreenGame').click();
  await page.getByRole('button',{name:'Back to library',exact:true}).click();await page.getByRole('button',{name:"Yes and don't save state",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playerDialog').open);
  assert.equal(await page.locator('.crt-display').count(),0);assert.deepEqual(errors,[]);console.log('Canvas renderer, persisted setting, paused page-fill and cleanup passed');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
