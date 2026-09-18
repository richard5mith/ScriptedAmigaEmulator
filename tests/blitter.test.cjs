const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the real register handlers and scheduled DMA work with a small
// deterministic scheduler. No ROM or copyrighted game data is required.
function machine({immediate = false} = {}) {
 let pending = null, interrupts = 0, copperNotifications = 0;
 const ctx = vm.createContext({
  Uint8Array, Uint32Array, Int32Array, Math,
  SAEE_None: 0, SAEC_Events_CYCLE_UNIT: 512, SAEC_Events_CYCLE_UNIT_INV: 1 / 512,
  SAEC_Events_EV2_BLITTER: 0, SAEC_Custom_DMAF_BLTEN: 64,
  SAEC_Custom_DMAF_BLTPRI: 1024, SAEC_Custom_INTF_BLIT: 64,
  SAEC_spcflag_BLTNASTY: 512, SAEC_Config_Chipset_Mask_OCS: 0,
  SAEV_Events_currcycle: 0, SAEV_CPU_cycles: 0, SAEV_Copper_access: false,
  SAEV_spcflags: 0, SAEV_Custom_dmacon: 576, SAEV_Memory_chipMask: 0x1fffff,
  SAEV_config: {chipset: {mask: 7, blitter: {cycle_exact: false, immediate, waiting: 0}}, cpu: {speed: 0, model: 68020}},
  SAER_Memory_chipData: new Uint8Array(2 * 1024 * 1024),
  SAEF_warn() {}, SAEF_log() {},
  SAEF_Custom_dmaen: flag => (ctx.SAEV_Custom_dmacon & (512 | flag)) === (512 | flag),
  SAEF_setSpcFlags(flag) {ctx.SAEV_spcflags |= flag;},
  SAEF_clrSpcFlags(flag) {ctx.SAEV_spcflags &= ~flag;},
  SAER: {
   events: {
    current_hpos: () => 0,
    event2_newevent: (id, cycles, data) => {pending = {cycles, data, at: ctx.SAEV_Events_currcycle + cycles * 512};},
    event2_remevent: () => {pending = null;}
   },
   copper: {blitter_done_notify() {copperNotifications++;}},
   custom: {send_interrupt() {interrupts++;}},
   playfield: {dcheck_is_blit_dangerous() {}}
  }
 });
 vm.runInContext(fs.readFileSync('sae/blitter.js', 'utf8'), ctx);
 const blitter = ctx.SAER.blitter = new ctx.SAEO_Blitter();
 blitter.setup(); blitter.reset();
 const memory = ctx.SAER_Memory_chipData;
 function copy({source = 0x100, destination = 0x200, width = 2, height = 4, sourceModulo = 0, destinationModulo = 0, firstMask = 0xffff, lastMask = 0xffff} = {}) {
  blitter.BLTCON0(0, 0x9f0); blitter.BLTCON1(0, 0);
  blitter.BLTAFWM(0, firstMask); blitter.BLTALWM(0, lastMask);
  blitter.BLTAMOD(0, sourceModulo); blitter.BLTDMOD(0, destinationModulo);
  blitter.BLTAPTH(0, source >>> 16); blitter.BLTAPTL(0, source & 0xffff);
  blitter.BLTDPTH(0, destination >>> 16); blitter.BLTDPTL(0, destination & 0xffff);
  blitter.BLTSIZE(0, (height & 1023) * 64 + (width & 63));
 }
 function step() {
  assert.ok(pending, 'a blitter event must be scheduled');
  const event = pending; pending = null;
  ctx.SAEV_Events_currcycle = event.at;
  blitter.handler(event.data);
 }
 function advance(cycles) {
  const until = ctx.SAEV_Events_currcycle + cycles * 512;
  while (pending && pending.at <= until) step();
  ctx.SAEV_Events_currcycle = until;
 }
 function finish() {
  let count = 0;
  while (pending) {assert.ok(count++ < 10000, 'blit must finish'); step();}
 }
 return {ctx, blitter, memory, copy, step, advance, finish,
  restorePending(value) {pending=value;}, get pending() {return pending;}, get interrupts() {return interrupts;},
  get copperNotifications() {return copperNotifications;}};
}

test('delayed copies preserve CPU writes to rows the blitter has already passed', () => {
 const m = machine();
 m.memory.fill(0x55, 0x100, 0x110);
 m.copy();
 assert.equal(m.memory[0x200], 0, 'copy is not immediate');
 m.advance(4); // Two A reads and two D writes; the other rows are still pending.
 assert.deepEqual(Array.from(m.memory.slice(0x200, 0x208)), [85, 85, 85, 85, 0, 0, 0, 0]);
 assert.equal(m.ctx.SAEV_Blitter_bltstate, 3);
 assert.equal(m.ctx.SAEV_Blitter_interrupt, false);
 assert.equal(m.interrupts, 0);
 // The SWOS failure: CPU reuses a buffer while the rest of a long blit runs.
 m.memory[0x200] = 0x77;
 m.memory[0x100] = 0x99;
 m.finish();
 assert.equal(m.memory[0x200], 0x77);
 assert.deepEqual(Array.from(m.memory.slice(0x204, 0x210)), Array(12).fill(85));
 assert.equal(m.ctx.SAEV_Events_currcycle, 16 * 512);
 assert.equal(m.ctx.SAEV_Blitter_bltstate, 0);
 assert.equal(m.ctx.SAEV_Blitter_interrupt, true);
 assert.equal(m.interrupts, 1);
 assert.equal(m.copperNotifications, 1);
});

test('register changes finish remaining rows even with pending display slowdown', () => {
 const m = machine(); m.memory.fill(0x55, 0x100, 0x110); m.copy(); m.step();
 m.blitter.blitter_slowdown(0, 100, 8, 0);
 m.blitter.BLTDPTL(0, 0x300);
 assert.deepEqual(Array.from(m.memory.slice(0x200, 0x210)), Array(16).fill(85));
 assert.equal(m.memory[0x300], 0);
 assert.equal(m.pending, null);
 assert.equal(m.interrupts, 1);
});

test('DMA disabled before or during a copy pauses progress without completion', () => {
 for (const beforeStart of [true, false]) {
  const m = machine(); m.memory.fill(0x55, 0x100, 0x110);
  if (beforeStart) m.ctx.SAEV_Custom_dmacon &= ~64;
  m.copy();
  if (!beforeStart) m.step();
  m.ctx.SAEV_Custom_dmacon &= ~64;
  const paused = m.memory.slice(0x200, 0x210);
  m.step(); m.step();
  assert.deepEqual(m.memory.slice(0x200, 0x210), paused);
  assert.equal(m.interrupts, 0);
  m.ctx.SAEV_Custom_dmacon |= 64;
  m.blitter.blitter_check_start(); m.finish();
  assert.deepEqual(Array.from(m.memory.slice(0x200, 0x210)), Array(16).fill(85));
  assert.equal(m.interrupts, 1);
 }
});

test('row masks apply on every slice and a zero BLTSIZE height still means 1024 rows', () => {
 const m = machine(); m.memory.fill(0xff, 0x100, 0x110);
 m.copy({firstMask: 0xff00, lastMask: 0x00ff}); m.finish();
 assert.deepEqual(Array.from(m.memory.slice(0x200, 0x210)), Array(4).fill([255, 0, 0, 255]).flat());
 const large = machine(); large.memory.fill(0x55, 0x1000, 0x2000);
 large.copy({source: 0x1000, destination: 0x3000, height: 1024});
 large.step(); assert.equal(large.memory[0x3004], 0);
 large.finish(); assert.equal(large.memory[0x3fff], 85); assert.equal(large.memory[0x4000], 0);
});

test('overlapping and strided copies keep their existing bulk pipeline', () => {
 const m = machine();
 for (let i = 0; i < 16; i++) m.memory[0x100 + i] = i + 1;
 m.copy({destination: 0x102});
 assert.equal(m.pending.cycles, 16);
 m.step(); assert.equal(m.pending, null);
 assert.deepEqual(Array.from(m.memory.slice(0x102, 0x112)), Array.from({length: 16}, (_, i) => i + 1));
 const strided = machine(); strided.memory.fill(0x55, 0x100, 0x120);
 strided.copy({sourceModulo: 2, destinationModulo: 2});
 assert.equal(strided.pending.cycles, 16);
 strided.step(); assert.equal(strided.pending, null);
 assert.deepEqual(Array.from(strided.memory.slice(0x200, 0x20c)), [85, 85, 85, 85, 0, 0, 85, 85, 85, 85, 0, 0]);
});

test('immediate mode remains immediate and schedules no delayed rows', () => {
 const m = machine({immediate: true}); m.memory.fill(0x55, 0x100, 0x110); m.copy();
 assert.equal(m.pending, null);
 assert.deepEqual(Array.from(m.memory.slice(0x200, 0x210)), Array(16).fill(85));
 assert.equal(m.interrupts, 1);
});

test('a checkpoint resumes a partially completed blit in a fresh device',()=>{
 const codec=require('../sae/state.js'),old=machine(),fresh=machine();
 function registry(m){
  const reg={functions:new Map(),byName:new Map(),anchors:new Map([[m.blitter,'blitter']]),byAnchor:new Map([['blitter',m.blitter]]),externals:new Map(),byExternal:new Map()};
  for(const [key,fn]of Object.entries(m.blitter._saeState.functions())){reg.functions.set(fn,'local/'+key);reg.byName.set('local/'+key,fn);}
  for(const [key,fn]of Object.entries(m.blitter))if(typeof fn==='function'){reg.functions.set(fn,key);reg.byName.set(key,fn);}
  function constant(value,name){if(!value||typeof value!=='object'||reg.externals.has(value))return;reg.externals.set(value,name);reg.byExternal.set(name,value);for(const key of Object.keys(value))constant(value[key],name+'/'+key);}
  for(const [key,value]of Object.entries(m.blitter._saeState.constants()))constant(value,key);
  const seen=new Set();function functions(value,path){if(typeof value==='function'){if(!reg.functions.has(value)){reg.functions.set(value,path);reg.byName.set(path,value);}return;}if(!value||typeof value!=='object'||seen.has(value)||ArrayBuffer.isView(value))return;seen.add(value);for(const key of Object.keys(value))functions(value[key],path+'/'+key);}
  functions(m.blitter._saeState.get(),'private');return reg;
 }
 old.memory.fill(0x55,0x100,0x110);old.copy();old.step();old.memory[0x200]=0x77;
 const globals=Object.fromEntries(Object.keys(old.ctx).filter(k=>k.startsWith('SAEV_')&&k!=='SAEV_config').map(k=>[k,old.ctx[k]]));
 const snapshot=codec.encode({blitter:old.blitter,memory:old.memory,pending:old.pending,globals,info:old.ctx.SAER_Blitter_blt_info},registry(old));
 const decoded=codec.decode(snapshot,registry(fresh));decoded.commit();const state=decoded.result;
 Object.assign(fresh.ctx,state.globals);fresh.ctx.SAER_Memory_chipData=state.memory;fresh.ctx.SAER_Blitter_blt_info=state.info;fresh.restorePending(state.pending);
 assert.equal(fresh.blitter._saeState.get().copy_rows_remaining,3);fresh.finish();
 assert.equal(state.memory[0x200],0x77);assert.deepEqual(Array.from(state.memory.slice(0x204,0x210)),Array(12).fill(85));
 assert.equal(fresh.interrupts,1);assert.equal(fresh.ctx.SAEV_Events_currcycle,16*512);
});
