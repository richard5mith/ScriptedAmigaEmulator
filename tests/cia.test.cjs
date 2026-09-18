const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function machine(velvet = false) {
 const ctx = vm.createContext({
  SAEC_Events_CYCLE_UNIT:512, SAEC_Events_EV_CIA:0, SAEV_Events_currcycle:0,
  SAER_Events_eventtab:[{oldcycles:0}], SAEC_Config_Chipset_Compatible_A1000V:1,
  SAEC_Memory_addrbank_flag_IO:1, SAEC_Memory_addrbank_flag_CIA:2,
  SAEO_Memory_addrbank: function() {}, SAEF_Memory_defaultXLate() {}, SAEF_Memory_defaultCheck() {},
  SAEV_config:{chipset:{compatible:velvet ? 1 : 0},serial:{enabled:false}},
  SAER:{m68k:{doint() {}},serial:{rbf_clear() {}},devices:{rethink() {ctx.SAER.cia.rethink();}}}
 });
 for (const file of ['custom','cia']) vm.runInContext(fs.readFileSync(`sae/${file}.js`,'utf8'),ctx);
 const custom = ctx.SAER.custom = new ctx.SAEO_Custom();
 const cia = ctx.SAER.cia = new ctx.SAEO_CIA();
 const cs = custom._saeState.get();cs.intena_internal = 0x6008;custom._saeState.set(cs);
 const cf = cia._saeState.functions(), pf = custom._saeState.functions();
 function interrupt(chip) {
  const s = cia._saeState.get();s[`cia${chip}icr`] = 2;s[`cia${chip}imask`] = 2;cia._saeState.set(s);
  cf[chip === 'a' ? 'RethinkICRA' : 'RethinkICRB']();
 }
 return {ctx,custom,cia,interrupt,read:chip=>cf[chip === 'a' ? 'ReadCIAA' : 'ReadCIAB'](13),pending:()=>pf.INTREQR()};
}
test('CIA interrupts acknowledge in either order while both acknowledgments remain necessary (#32)', () => {
 for (const velvet of [false,true]) for (const chip of ['a','b']) for (const ciaFirst of [false,true]) {
  const m = machine(velvet), mask = chip === 'a' || velvet ? 8 : 0x2000, level = mask === 8 ? 2 : 6;
  m.interrupt(chip);assert.equal(m.custom.intlev(),level);
  if (ciaFirst) {
   assert.equal(m.read(chip),0x82);assert.equal(m.cia.irq_mask(),0);
   assert.equal(m.pending() & mask,mask);assert.equal(m.custom.intlev(),level);
   m.custom.INTREQ(mask);
  } else {
   m.custom.INTREQ(mask);
   assert.equal(m.ctx.SAEV_Custom_intreq & mask,0,'INTREQ latch clears even while CIA pin is asserted');
   assert.equal(m.pending() & mask,mask);assert.equal(m.custom.intlev(),level);
   m.custom.INTREQ(mask); // A second clear must not hide the live pin.
   assert.equal(m.custom.intlev(),level);
   assert.equal(m.read(chip),0x82);
  }
  assert.equal(m.pending() & mask,0);assert.equal(m.custom.intlev(),-1);
  assert.equal(m.read(chip),0);m.cia.rethink();assert.equal(m.custom.intlev(),-1);
  m.interrupt(chip);assert.equal(m.custom.intlev(),level,'a later underflow still interrupts');
 }
});
test('CIA pin status does not discard software requests or another active CIA', () => {
 const m = machine(); m.interrupt('a');m.interrupt('b');
 m.custom.INTREQ(8);m.read('a');assert.equal(m.custom.intlev(),6);
 m.read('b');assert.equal(m.custom.intlev(),6);m.custom.INTREQ(0x2000);assert.equal(m.custom.intlev(),-1);
 m.custom.INTREQ(0x8008);m.read('a');assert.equal(m.custom.intlev(),2);
 m.custom.INTREQ(8);assert.equal(m.custom.intlev(),-1);
});
