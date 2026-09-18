/* CRT presentation pass, adapted from zfast_crt_geo_svideo:
 * https://github.com/libretro/glsl-shaders/blob/master/crt/shaders/zfast_crt_geo_svideo.glsl
 * Copyright (C) 2017 Greg Hogan (SoltanGris42), 2023 Jose Linares (Dogway).
 * SAE WebGL adaptation: GPL-2.0-or-later, as is the upstream shader.
 * Uses a separate display canvas so neither guest video nor saved state changes.
 */
var SAECRT = (() => {
  'use strict';
  const vertex = `attribute vec2 position;
    varying vec2 uv;
    void main() { uv = vec2(position.x, -position.y)*0.5+0.5; gl_Position=vec4(position,0.0,1.0); }`;
  const fragment = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D image;
    uniform vec2 inputSize;
    uniform vec2 outputSize;
    varying vec2 uv;
    const mat3 phosphor = mat3(
      0.92060387, 0.06930985, -0.05164512,
      0.08702832, 0.94945264, -0.00786066,
      0.01323396, 0.11829413, 1.023242);
    void main() {
      vec2 xy=uv;
      vec2 offset=vec2(0.70,-0.30)/(inputSize*2.0);
      vec2 a=texture2D(image,xy+vec2(offset.x,-offset.y)).rg;
      vec3 b=texture2D(image,xy).rgb;
      vec2 c=texture2D(image,xy+vec2(-offset.x,offset.y)).gb;
      vec3 colour=vec3(a.r*0.5,(a.g+c.r)*0.25,c.g*0.5)+0.5*b;
      vec2 edge=uv*(1.0-uv);
      float vig=min(sqrt(edge.x*edge.y*46.0),1.0);
      // SAE doubles PAL/NTSC lines; use the original beam line count.
      float f=fract(uv.y*inputSize.y+0.25)-0.5;
      float y=f*f;
      float scan=1.5-9.0*(y-y*y);
      // Fade scanlines when too small to resolve, avoiding heavy moire.
      scan=mix(1.0,scan,smoothstep(1.0,2.0,outputSize.y/inputSize.y));
      float scale=outputSize.y>1499.0?0.3333:0.5;
      float mask=1.0-(fract(floor(uv.x*outputSize.x)*-scale)<scale?0.4:0.0);
      colour=max((colour*colour)*(phosphor*vig),0.0);
      colour=clamp(colour*mix(scan*mask,1.0,dot(colour,vec3(0.26667))),0.0,1.0);
      vec3 circle=colour-1.0;
      float power=1.0/((1.0-0.0325*9.0)*(1.0-0.311*0.4))-1.2;
      gl_FragColor=vec4(mix(sqrt(colour),sqrt(max(1.0-circle*circle,0.0)),power),1.0);
    }`;
  function attach(host, onError = () => {}) {
    const canvas=document.createElement('canvas');
    canvas.className='crt-display';canvas.setAttribute('aria-hidden','true');
    const gl=canvas.getContext('webgl',{alpha:false,depth:false,antialias:false,preserveDrawingBuffer:true});
    if(!gl) { onError(); return {destroy(){}}; }
    let frame=0, dead=false, source=null, program=null, buffer=null, texture=null;
    const shaders=[];
    function destroy() {
      if(dead)return;dead=true;cancelAnimationFrame(frame);
      source?.classList.remove('crt-source');canvas.remove();
      canvas.removeEventListener('webglcontextlost',lost);
      if(texture)gl.deleteTexture(texture);if(buffer)gl.deleteBuffer(buffer);
      if(program)gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    function lost(event){event.preventDefault();destroy();onError();}
    canvas.addEventListener('webglcontextlost',lost);
    try {
      program=gl.createProgram();
      for(const [type,code] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
        const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,code);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program,shader);
      }
      gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const location=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
      texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.LINEAR);
      for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.CLAMP_TO_EDGE);
      const inputSize=gl.getUniformLocation(program,'inputSize'),outputSize=gl.getUniformLocation(program,'outputSize');
      host.appendChild(canvas);
      function draw() {
        if(dead)return;
        try {
          const next=host.querySelector('canvas:not(.crt-display)');
          if(source!==next){source?.classList.remove('crt-source');source=next;}
          if(source&&source.width&&source.height) {
            const bounds=host.getBoundingClientRect(),ratio=source.width/source.height;
            const width=Math.min(bounds.width,bounds.height*ratio),height=width/ratio;
            // Limit fill cost on very high DPI displays.
            const dpr=Math.min(window.devicePixelRatio||1,2,1920/Math.max(width,1));
            const w=Math.max(1,Math.round(width*dpr)),h=Math.max(1,Math.round(height*dpr));
            if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
            canvas.style.setProperty('width',width+'px','important');canvas.style.setProperty('height',height+'px','important');
            gl.uniform2f(inputSize,source.width/2,source.height/2);gl.uniform2f(outputSize,w,h);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
            gl.drawArrays(gl.TRIANGLES,0,6);source.classList.add('crt-source');
          }
          frame=requestAnimationFrame(draw);
        } catch(error){destroy();onError(error);}
      }
      draw();return {destroy};
    } catch(error){destroy();onError(error);return {destroy};}
  }
  // Picture is presentation only. Also accepts existing checkpoints containing it.
  function differences(a,b) {
    try {
      const saved=JSON.parse(a),current=JSON.parse(b);
      if(!saved.options||!current.options)throw Error('Missing settings');
      const result=[],labels={build:'Emulator build',version:'Save-state format',rom:'Kickstart ROM',sourceMedia:'Game disk or WHDLoad files'};
      const optionLabels={model:'Amiga model',renderer:'Renderer',region:'Region',rom:'ROM selection',runtime:'WHDLoad selection',sound:'Sound',stereo:'Stereo',controller:'Controller',movement:'Movement keys',fire:'Fire key',mouseLock:'Mouse capture',cpu:'CPU',speed:'CPU speed',compatible:'CPU compatibility',chip:'Chip RAM',fast:'Fast RAM',slow:'Slow RAM',floppySpeed:'Floppy speed',readonly:'Read-only disks',multiDrive:'Multiple drives',variant:'Game version'};
      const format=value=>value===undefined?'unset':value===true?'on':value===false?'off':value===''?'default':String(value);
      for(const key of new Set([...Object.keys(saved),...Object.keys(current)])) {
        if(key==='options')continue;
        if(JSON.stringify(saved[key])!==JSON.stringify(current[key]))result.push(labels[key]||key);
      }
      for(const key of new Set([...Object.keys(saved.options),...Object.keys(current.options)])) {
        if(key==='picture')continue;
        if(saved.options[key]!==current.options[key])result.push((optionLabels[key]||key)+': '+format(saved.options[key])+' → '+format(current.options[key]));
      }
      return result;
    } catch {return ['Unreadable save-state details'];}
  }
  function compatible(a,b) {return differences(a,b).length===0;}
  return {attach,compatible,differences};
})();
