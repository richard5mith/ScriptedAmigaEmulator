const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function machine() {
 const handlers = {};
 const target = {addEventListener(name, fn) {handlers[name] = fn;}, removeEventListener(name) {delete handlers[name];}};
 const ctx = vm.createContext({
  window:target, document:{...target,hidden:false},
  SAEC_Config_Ports_Type_JoyEmu:3, SAEC_Config_Ports_Move_Arrows:1,
  SAEC_Config_Ports_Move_Numpad:2, SAEC_Config_Ports_Move_WASD:3,
  SAEV_config:{keyboard:{enabled:true},ports:[{type:0},{type:3,move:1,fire:['Space','AltRight']}]},
  SAER:{paused:false}, SAEF_warn() {}
 });
 vm.runInContext(fs.readFileSync('sae/input.js','utf8'),ctx);
 const input = ctx.SAER.input = new ctx.SAEO_Input(), state = input._saeState.get();
 const Queue = input._saeState.functions().input_queue_struct;
 state.input_queue = Array.from({length:16},()=>Object.assign(new Queue(),{linecnt:-1,nextlinecnt:-1}));
 state.horizclear.fill(true);state.vertclear.fill(true);
 input._saeState.set(state);input.keyboard.setup();
 function drain() {
  const s = input._saeState.get();
  for (const event of s.input_queue) if (event.linecnt >= 0) {input._saeState.functions().integrateEvent(event);event.linecnt = -1;}
 }
 function key(code,down,extra = {}) {input.keyboard.keyPress({code,preventDefault(){},...extra},down);}
 return {ctx,input,handlers,drain,key,state:()=>input._saeState.get()};
}
test('mouse bursts cannot fill the queue and lose a joystick release (#39)', () => {
 const m = machine();m.key('ArrowLeft',true);m.drain();assert.equal(m.state().joydir[1],1);
 for (let i = 0; i < 1000; i++) m.input.registerEvent(0,20,2,-1);
 m.key('ArrowLeft',false);m.drain();assert.equal(m.state().joydir[1],0);
 assert.deepEqual(Array.from(m.state().mouse_delta[0]).slice(0,2),[2000,-1000]);
});
test('digital queue overflow preserves releases and ordering rather than dropping input', () => {
 const m = machine();
 for (let i = 0; i < 50; i++) {m.input.registerEvent(1,30,1,true);m.input.registerEvent(1,30,1,false);}
 m.drain();assert.equal(m.state().joydir[1],0);
 m.input.registerEvent(1,30,1,true);m.input.registerEvent(1,30,2,true);m.input.registerEvent(1,30,1,false);m.input.registerEvent(1,30,1,true);
 m.drain();assert.equal(m.state().joydir[1],1,'latest opposing direction wins');
});
test('repeat suppression, prevented keyups and focus loss cannot leave held joystick keys', () => {
 const m = machine();m.key('ArrowLeft',true);m.drain();
 for (let i = 0; i < 1000; i++) m.key('ArrowLeft',true,{repeat:true});
 m.key('ArrowLeft',false,{defaultPrevented:true});m.drain();assert.equal(m.state().joydir[1],0);
 m.key('ArrowRight',true);m.key('Space',true);m.drain();assert.equal(m.state().joydir[1],2);assert.equal(m.state().joybutton[1],1);
 m.handlers.blur();m.drain();assert.equal(m.state().joydir[1],0);assert.equal(m.state().joybutton[1],0);
 m.key('ArrowUp',true);m.drain();m.ctx.document.hidden = true;m.handlers.visibilitychange();m.drain();assert.equal(m.state().joydir[1],0);
 m.input.keyboard.cleanup();assert.equal(m.handlers.blur,undefined);
});
test('focus-loss releases are retained while paused for the next emulated scanline', () => {
 const m = machine();m.key('ArrowDown',true);m.drain();m.ctx.SAER.paused = true;
 m.handlers.blur();m.ctx.SAER.paused = false;m.drain();assert.equal(m.state().joydir[1],0);
});
