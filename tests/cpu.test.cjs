const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function cpu() {
 const ctx = vm.createContext({});
 vm.runInContext(fs.readFileSync('sae/cpu.js', 'utf8'), ctx);
 const core = new ctx.SAEO_CPU(), state = core._saeState.get();
 let extension = 0;
 state.coreSyncPC = () => {};
 state.coreNext16 = () => extension;
 core._saeState.set(state);
 const functions = core._saeState.functions();
 functions.mkEATabs();
 return {regs: state.regs, functions, extension(value) {extension = value;}};
}
// Independent bit-at-a-time oracle: no JavaScript variable-width shifts.
function shift(op, width, value, count, x) {
 const mask = (1n << BigInt(width)) - 1n, sign = 1n << BigInt(width - 1);
 let d = BigInt(value) & mask, c = false, v = false;
 for (let i = 0; i < count; i++) {
  const negative = (d & sign) !== 0n;
  if (op.endsWith('L')) {
   c = negative;
   d = (d * 2n) & mask;
   if (op === 'ASL' && negative !== ((d & sign) !== 0n)) v = true;
  } else {
   c = (d & 1n) !== 0n;
   d /= 2n;
   if (op === 'ASR' && negative) d |= sign;
  }
  x = c;
 }
 return {d: Number(d), c, x, v, n: (d & sign) !== 0n, z: d === 0n};
}
test('all shift sizes and counts preserve data, flags and upper register bits', () => {
 const {regs, functions} = cpu();
 let seed = 123;
 const values = [0, 1, 0xffffffff, 0x80000000, 0x40000000, 0x8000, 0x4000, 0x80, 0x40, 0x7fffffff, 0x7fff, 0x7f];
 for (let i = 0; i < 64; i++) {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; values.push(seed);}
 for (const op of ['ASL','ASR','LSL','LSR']) for (const width of [8,16,32])
  for (const value of values) for (let count = 0; count < 64; count++) for (const x of [false,true]) {
   regs.d[0] = value; regs.d[1] = count; regs.x = x;
   const expected = shift(op, width, value, count, x);
   const cycles = functions[`I_${op}_${width}`]({Dy:0, cr:1, ir:true, cyc:[4,1,2]});
   const upper = width === 32 ? 0 : (value & (0xffffffff << width)) >>> 0;
   assert.equal(regs.d[0], (upper | expected.d) >>> 0, `${op}.${width} ${value} by ${count}`);
   for (const flag of ['c','x','v','n','z']) assert.equal(regs[flag], expected[flag], `${op}.${width} ${value} by ${count}: ${flag}`);
   assert.deepEqual(Array.from(cycles), [4+2*count,1,2]);
  }
});
test('immediate shifts use the decoded count rather than a data register', () => {
 const {regs,functions} = cpu(); regs.d[0] = 1; regs.d[1] = 63;
 functions.I_LSL_32({Dy:0, cr:1, ir:false, cyc:[4,0,0]}); assert.equal(regs.d[0],2);
});
test('68020 multiply flags follow the selected result width and signed range', () => {
 const m = cpu(), r = m.regs;
 const values = [0,1,2,32767,32768,65535,65536,0x40000000,0x7fffffff,0x80000000,0xffff0000,0xffffffff];
 for (const signed of [false,true]) for (const wide of [false,true]) for (const a of values) for (const b of values) {
  r.d[0] = a; r.d[2] = b; r.x = true;
  m.extension((signed ? 0x800 : 0) | (wide ? 0x400 : 0) | 1);
  const product = (signed ? BigInt.asIntN(32,BigInt(a)) : BigInt(a)) * (signed ? BigInt.asIntN(32,BigInt(b)) : BigInt(b));
  const result = BigInt.asUintN(wide ? 64 : 32, product);
  m.functions.I_MULx({ea:2,cyc:[4,0,0]});
  assert.equal(r.d[0],Number(result & 0xffffffffn));
  if (wide) assert.equal(r.d[1],Number(result >> 32n));
  assert.equal(r.n, (result & (1n << BigInt(wide ? 63 : 31))) !== 0n);
  assert.equal(r.z,result === 0n);
  assert.equal(r.v,!wide && (signed ? product < -0x80000000n || product > 0x7fffffffn : product > 0xffffffffn));
  assert.equal(r.c,false); assert.equal(r.x,true);
 }
});
test('signed 64-bit division detects overflow before modifying either destination', () => {
 const m = cpu(), r = m.regs;
 const dividends = [0n,1n,-1n,0x7fffffffn,0x80000000n,-0x80000000n,0x100000000n,-0x100000000n,0x7fffffffffffffffn,-0x8000000000000000n];
 for (const dividend of dividends) for (const divisor of [1n,-1n,2n,-2n,0x7fffffffn,-0x80000000n]) {
  const raw = BigInt.asUintN(64,dividend), lo = Number(raw & 0xffffffffn), hi = Number(raw >> 32n);
  r.d[0] = lo; r.d[1] = hi; r.d[2] = Number(BigInt.asUintN(32,divisor)); r.x = true;
  m.extension(0xc01); m.functions.I_DIVx({ea:2,cyc:[4,0,0]});
  const q = dividend/divisor, overflow = q < -0x80000000n || q > 0x7fffffffn;
  assert.equal(r.v,overflow,`${dividend} / ${divisor}`);
  assert.equal(r.d[0],overflow ? lo : Number(BigInt.asUintN(32,q)));
  assert.equal(r.d[1],overflow ? hi : Number(BigInt.asUintN(32,dividend % divisor)));
  if (!overflow) {assert.equal(r.z,q === 0n);assert.equal(r.n,q < 0n);}
  assert.equal(r.c,false);assert.equal(r.x,true);
 }
});
