const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../launcher/crt.js'),'utf8'),context);
const identity=(picture,extra={})=>JSON.stringify({options:{model:'A1200',renderer:'auto',picture},rom:'abc',build:'one',sourceMedia:['disk'],version:1,...extra});
test('changing only picture accepts existing checkpoints but preserves machine and media checks',()=>{
 const compatible=context.SAECRT.compatible;
 for(const old of ['sharp','smooth','scanlines','crt'])assert.ok(compatible(identity(old),identity('crt')));
 for(const change of [{rom:'other'},{build:'two'},{sourceMedia:['other']},{version:2},{options:{model:'A500',renderer:'auto',picture:'crt'}},{options:{model:'A1200',renderer:'canvas',picture:'crt'}}])assert.equal(compatible(identity('crt'),identity('crt',change)),false);
 assert.equal(compatible('bad',identity('crt')),false);
});
test('restore diagnostics identify changed settings and files independently of property order',()=>{
 const {differences,compatible}=context.SAECRT;
 assert.deepEqual(Array.from(differences(identity('sharp'),identity('crt',{build:'two',rom:'other'}))),['Kickstart ROM','Emulator build']);
 assert.deepEqual(Array.from(differences(identity('sharp'),identity('crt',{options:{model:'A1200',renderer:'canvas',picture:'crt'}}))),['Renderer: auto → canvas']);
 const old=JSON.parse(identity('sharp'));
 const reordered=JSON.stringify({version:old.version,build:old.build,sourceMedia:old.sourceMedia,rom:old.rom,options:{picture:'crt',renderer:'auto',model:'A1200'}});
 assert.ok(compatible(identity('sharp'),reordered));
});
