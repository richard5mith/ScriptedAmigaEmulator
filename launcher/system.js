/* System-file matching and shared machine configuration. GPL-2.0-or-later. */
var SAESystem = (function() {
  'use strict';
  const defaults = Object.freeze({model:'A1200', rom:'auto', runtime:'auto', region:'pal', picture:'sharp', renderer:'auto', sound:true, stereo:true,
    controller:'keyboard', movement:'arrows', fire:'ShiftRight', mouseLock:true, cpu:'auto', speed:'original', compatible:false,
    chip:'auto', fast:'auto', slow:'auto', floppySpeed:'100', readonly:false, multiDrive:false, variant:''});
  function binary(data) {
    const chunks=[]; for(let i=0;i<data.length;i+=8192) chunks.push(String.fromCharCode.apply(null,data.subarray(i,i+8192)));
    return chunks.join('');
  }
  function configFile(file, data) {return {name:file.name, data, size:data.length, crc32:false};}
  function kickName(info) {
    if(!info) return null;
    if(info.subVer===34 && info.subRev===5) return 'kick34005.A500';
    if(info.subVer===33 && info.subRev===180) return 'kick33180.A500';
    if(info.subVer===40 && info.subRev===63) return 'kick40063.A600';
    if(info.subVer===40 && info.subRev===68) return info.models.includes('A1200') ? 'kick40068.A1200' : info.models.includes('A4000') ? 'kick40068.A4000' : null;
    return null;
  }
  async function scan(files, emulator) {
    const result={roms:[], runtimes:[], support:[], key:null, warnings:[]}, candidates=[];
    for(const file of files) {
      if(/\.(zip|lha|lzh)$/i.test(file.name)) {
        try {
          const archive=await SAEF_Archive.open(file.name,await file.read());
          for(const entry of archive.entries) if(!entry.directory) candidates.push({...entry, path:file.path+'::'+entry.name, read:entry.read});
        } catch(error) {result.warnings.push(file.name+': '+error.message);}
      } else candidates.push(file);
    }
    const key=candidates.find(f => /(^|\/)rom\.key$/i.test(f.name));
    if(key) {
      try {result.key=configFile(key, await key.read());Object.assign(emulator.getConfig().memory.romKey,result.key);}
      catch(error) {result.warnings.push('Could not read the ROM key: '+error.message);}
    }
    const support=new Map();
    for(const file of candidates) {
      const name=file.name.split('/').pop();
      try {
        if(/^WHDLoad$/i.test(name)) {
          if(file.size>4*1024*1024) throw new Error('The WHDLoad executable is too large.');
          const data=await file.read();
          if(data[0]===0 && data[1]===0 && data[2]===3 && data[3]===243) result.runtimes.push({...file, name, data});
          else result.warnings.push(file.name+' is not a WHDLoad executable.');
        } else if(/\.rtb$/i.test(name)) support.set(name.toLowerCase(), {name:'Devs/Kickstarts/'+name, size:file.size||0, directory:false, read:file.read});
        else if(/\.(rom|bin)$/i.test(name) || /^kick\d+\.(a500|a600|a1200|a4000)$/i.test(name)) {
          if(file.size>2*1024*1024) continue;
          let data=await file.read();
          if(data.length<256*1024 || data.length>2*1024*1024) continue;
          const info=new SAEO_RomInfo();
          let known=emulator.getRomInfo(info,configFile(file,binary(data)))===SAEE_None;
          // Some 256 KB ROM dumps repeat the image to fill a 512 KB chip.
          if(!known && data.length===512*1024 && data.subarray(0,data.length/2).every((byte,i)=>byte===data[i+data.length/2])) {
            const half=data.slice(0,data.length/2);
            known=emulator.getRomInfo(info,configFile(file,binary(half)))===SAEE_None;
            if(known)data=half;
          }
          const rom={...file,name,data,info:known?info:null}; result.roms.push(rom);
          const canonical=kickName(rom.info) || (/^kick\d+\./i.test(name)?name:null);
          if(canonical) support.set(canonical.toLowerCase(),{name:'Devs/Kickstarts/'+canonical, size:data.length, directory:false, read:async()=>data});
        }
      } catch(error) {result.warnings.push(file.name+': '+error.message);}
    }
    if(result.key) support.set('rom.key',{name:'Devs/Kickstarts/rom.key',size:result.key.size,directory:false,read:async()=>result.key.data});
    result.support={type:'folder',entries:[...support.values()]};
    return result;
  }
  function configure(emulator, settings, rom, key) {
    const models={A1200:SAEC_Model_A1200,A500:SAEC_Model_A500,'A500+':SAEC_Model_A500P,A600:SAEC_Model_A600,A3000:SAEC_Model_A3000,A4000:SAEC_Model_A4000};
    emulator.setDefaults();emulator.setModel(models[settings.model] || SAEC_Model_A1200,0);
    const cfg=emulator.getConfig(), info=emulator.getInfo(), modern=['A1200','A3000','A4000'].includes(settings.model);
    Object.assign(cfg.memory.rom,configFile(rom,rom.data));if(key)Object.assign(cfg.memory.romKey,key);
    cfg.memory.chipSize=settings.chip==='auto'?(modern?2<<20:cfg.memory.chipSize):Number(settings.chip)*1048576;
    cfg.memory.z2FastSize=settings.fast==='auto'?(modern?8<<20:0):Number(settings.fast)*1048576;
    if(settings.slow!=='auto')cfg.memory.bogoSize=Number(settings.slow)*1048576;
    if(settings.cpu!=='auto')cfg.cpu.model=Number(settings.cpu);
    cfg.cpu.speed=settings.speed==='maximum'?SAEC_Config_CPU_Speed_Maximum:SAEC_Config_CPU_Speed_Original;
    cfg.cpu.compatible=settings.compatible;
    cfg.chipset.ntsc=settings.region==='ntsc';
    cfg.video.id='myVideo';cfg.video.size_win.width=720;cfg.video.size_win.height=568;
    cfg.video.hresolution=SAEC_Config_Video_HResolution_HiRes;cfg.video.vresolution=SAEC_Config_Video_VResolution_Double;
    cfg.video.cursor=settings.mouseLock?SAEC_Config_Video_Cursor_Lock:SAEC_Config_Video_Cursor_Show;
    if(settings.renderer==='canvas'||!info.video.webGL)cfg.video.api=SAEC_Config_Video_API_Canvas;
    else if(settings.renderer==='webgl')cfg.video.api=SAEC_Config_Video_API_WebGL;
    cfg.audio.mode=settings.sound&&info.audio.webAudio?SAEC_Config_Audio_Mode_On:SAEC_Config_Audio_Mode_Off_Emul;
    cfg.audio.channels=settings.stereo?SAEC_Config_Audio_Channels_Stereo:SAEC_Config_Audio_Channels_Mono;
    cfg.floppy.speed=Number(settings.floppySpeed);
    cfg.ports[1].fire=[settings.fire,settings.fire==='ControlRight'?'ShiftRight':'ControlRight'];
    cfg.ports[1].move=settings.movement==='wasd'?SAEC_Config_Ports_Move_WASD:SAEC_Config_Ports_Move_Arrows;
    if(settings.controller==='gamepad') {
      const pad=Array.from(navigator.getGamepads?.()||[]).find(Boolean);
      if(!pad)throw new Error('Press a button on your gamepad, then try Play again. Or choose Keyboard in Controls.');
      cfg.ports[1].type=SAEC_Config_Ports_Type_Joy;cfg.ports[1].device=pad.index;
    }
    return cfg;
  }
  function mount(cfg, name, data, readonly) {
    // SAE's hardfile support uses the onboard IDE path, including virtual RDBs for plain partitions.
    if(![SAEC_Config_Chipset_Compatible_A600,SAEC_Config_Chipset_Compatible_A1200,SAEC_Config_Chipset_Compatible_A4000].includes(cfg.chipset.compatible))
      throw new Error('This game needs a hard drive. Choose A1200, A600, or A4000 in its settings.');
    const ci=cfg.mount.config[0].ci;
    Object.assign(ci.file,configFile({name},data));
    ci.controller_type=SAEC_Config_Mount_Controller_Type_MB_IDE;ci.controller_unit=0;
    ci.blocksize=512;ci.surfaces=1;ci.sectors=32;ci.highcyl=Math.floor(data.length/16384);ci.reserved=2;ci.devname='DH0';ci.dostype=0x444f5301;
    if(binary(data.subarray(0,4))==='RDSK'){ci.surfaces=0;ci.sectors=0;ci.highcyl=0;}
    ci.bootpri=0;ci.bootable=true;ci.readonly=readonly;
  }
  return {defaults,binary,configFile,kickName,scan,configure,mount};
})();
