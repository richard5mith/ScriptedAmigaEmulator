const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function machine(speed = 0, throttle = 0) {
 let now = 1000000, clockReads = 0, scheduled;
 const ctx = vm.createContext({
  Math:Object.assign(Object.create(Math),{truncate:Math.trunc}),
  SAEO_MAvg:class {set(v){return v;}get(){return 0;}clr(){}},
  SAEF_now() {assert.ok(++clockReads < 100,'frame pacing must not poll the clock');return now;},
  SAEF_sleep() {assert.fail('frame pacing must not busy wait');}, SAEF_log() {},
  SAEV_config:{cpu:{speed,speedThrottle:throttle}},
  SAER_Playfield_isvsync_chipset:()=>0,
  SAEV_Playfield_frame_rendered:false, SAEV_Playfield_picasso_on:false,
  SAEV_Playfield_frame_shown:false,
  SAER:{video:{render_screen:()=>true,show_screen(){}},playfield:{get_maxvpos_display:()=>312}},
  SAEV_command:0, SAEC_spcflag_MODE_CHANGE:1, SAEF_clrSpcFlags() {},
  SAER_CPU_run_func() {}, setTimeout(fn,delay) {scheduled = {fn,delay};}
 });
 vm.runInContext(fs.readFileSync('sae/events.js','utf8'),ctx);
 vm.runInContext(fs.readFileSync('sae/m68k.js','utf8'),ctx);
 const events = ctx.SAER.events = new ctx.SAEO_Events();
 const m68k = ctx.SAER.m68k = new ctx.SAEO_M68K();
 events.calc_vsynctimebase(50);
 return {ctx,events,m68k,get scheduled(){return scheduled;},time(t){now = t;clockReads = 0;}};
}
test('normal frame pacing yields an absolute timer deadline without consuming guest cycles', () => {
 const m = machine(), e = m.events;
 m.time(1005000);const cycles = m.ctx.SAEV_Events_currcycle;
 e.framewait2_normal();e.framewait();assert.equal(e.frame_delay(),15);
 assert.equal(m.ctx.SAEV_Events_currcycle,cycles);
 m.time(1027000);e.framewait();assert.equal(e.frame_delay(),13,'late timer delivery does not move the cadence');
 m.time(1061000);e.framewait();assert.equal(e.frame_delay(),0);
 m.time(1066000);e.framewait();assert.equal(e.frame_delay(),14,'a small missed deadline does not accumulate drift');
 m.time(2000000);e.framewait();assert.equal(e.frame_delay(),0,'long suspensions do not cause catch-up bursts');
 m.time(2005000);e.framewait();assert.equal(e.frame_delay(),15);
 e.reset_frame_rate_hack();assert.equal(e.frame_delay(),0,'restored/paused machines discard host deadlines');
 assert.equal(Object.hasOwn(e._saeState.get(),'frameResumeTime'),false);
});
test('maximum CPU speed only delays when its throttle requests pacing', () => {
 for (const throttle of [0,100]) {
  const m = machine(-1,throttle);m.time(1005000);m.events.framewait();
  assert.equal(m.events.frame_delay(),throttle ? 15 : 0);
 }
});
test('CPU continuation uses the frame deadline and excludes intentional waiting from reflow cost', () => {
 const m = machine();m.time(1005000);
 m.ctx.SAER_CPU_run_func = () => m.events.framewait();
 m.m68k.m68k_cycle(0,0);assert.equal(m.scheduled.delay,15);
 m.time(1021000);m.scheduled.fn();assert.equal(m.ctx.SAEV_Events_reflowtime,1000);
 assert.equal(m.scheduled.delay,19);
});
