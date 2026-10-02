// OGL circular gallery prototype. Inspired by React Bits CircularGallery's arc arrangement.
// No remote assets, fonts, requests or persistent browser data.
import {Renderer,Camera,Transform,Plane,Program,Mesh,Texture} from '/Users/biily/Biily/资产收集/交互动效/node_modules/ogl/src/index.js';
window.mountSiteGallery=(host,items)=>{
 const renderer=new Renderer({alpha:true,antialias:true,dpr:Math.min(devicePixelRatio,1.5)});
 const gl=renderer.gl;host.appendChild(gl.canvas);gl.clearColor(0,0,0,0);
 const camera=new Camera(gl,{fov:45});camera.position.z=18;
 const scene=new Transform(),geometry=new Plane(gl);
 const palette=['#ad8cff','#f75b30','#73a9ac','#c6f477','#b5b5c1'];
 const symbols=['◯','⌁','✦','↗','⌘'];
 const textures=[],programs=[],meshes=[];let target=0,position=0,last=0,raf,dead=false,inside=false,drag=false,px=0;
 const on=(type,fn,opt)=>{host.addEventListener(type,fn,opt);return()=>host.removeEventListener(type,fn,opt)};
 const count=Math.max(items.length,Math.ceil(12/Math.max(1,items.length))*items.length),spacing=4.65;
 items.forEach((s,i)=>{
 const c=document.createElement('canvas');c.width=480;c.height=650;const ctx=c.getContext('2d');
 ctx.fillStyle=palette[i%5];ctx.fillRect(0,0,480,650);ctx.fillStyle='#111';ctx.font='14px sans-serif';ctx.fillText('预览封面 · 示意',25,32);
 ctx.font='180px sans-serif';ctx.textAlign='center';ctx.fillText(symbols[i%5],240,250);ctx.textAlign='left';
 ctx.fillStyle='#0002';ctx.fillRect(0,340,480,1);ctx.fillStyle='#111';ctx.font='bold 34px sans-serif';
 let title=s[0];while(ctx.measureText(title).width>426)title=title.slice(0,-1);ctx.fillText(title,25,405);
 ctx.font='17px sans-serif';let desc=s[2];while(ctx.measureText(desc).width>424)desc=desc.slice(0,-1);ctx.fillText(desc,25,454);
 ctx.font='15px sans-serif';ctx.fillText(s[1]?new URL(s[1]).hostname:'网址待确认',25,593);
 const texture=new Texture(gl,{image:c,generateMipmaps:false});textures.push(texture);
 });
 for(let i=0;i<count;i++){
 const program=new Program(gl,{vertex:'attribute vec3 position;attribute vec2 uv;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragment:'precision mediump float;uniform sampler2D tMap;varying vec2 vUv;void main(){gl_FragColor=texture2D(tMap,vUv);}',uniforms:{tMap:{value:textures[i%items.length]}},cullFace:null});
 const mesh=new Mesh(gl,{geometry,program});mesh.scale.set(4.25,5.75,1);mesh.setParent(scene);meshes.push(mesh);programs.push(program);
 }
 function size(){renderer.setSize(host.clientWidth,host.clientHeight);camera.perspective({aspect:gl.canvas.width/gl.canvas.height})}
 const ro=new ResizeObserver(size);ro.observe(host);size();
 const clean=[
 on('wheel',e=>{e.preventDefault();target+=(Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY)*.012},{passive:false}),
 on('pointerdown',e=>{if(e.button!==0)return;drag=true;px=e.clientX;host.setPointerCapture(e.pointerId)}),
 on('pointermove',e=>{if(drag){target-=(e.clientX-px)*.026;px=e.clientX}}),
 on('pointerup',()=>drag=false),on('pointercancel',()=>drag=false),
 on('pointerenter',()=>inside=true),on('pointerleave',()=>inside=false),
 on('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();target+=e.key==='ArrowRight'?spacing:-spacing}})
 ];
 const visibility=new IntersectionObserver(es=>{visible=es[0].isIntersecting});let visible=true;visibility.observe(host);
 function tick(t){if(dead)return;raf=requestAnimationFrame(tick);const dt=Math.min((t-last)||16,40);last=t;if(document.hidden||!visible)return;
 if(!inside&&!drag)target+=dt*.00035;
 position+=(target-position)*.07;
 const total=count*spacing;meshes.forEach((m,i)=>{const x=((i*spacing-position+total/2)%total+total)%total-total/2;const radius=30;const xx=Math.min(Math.abs(x),radius-.1);m.position.x=x;m.position.y=-(radius-Math.sqrt(radius*radius-xx*xx))+.5;m.rotation.z=-Math.sign(x)*Math.asin(xx/radius);});
 renderer.render({scene,camera});
 }
 raf=requestAnimationFrame(tick);
 const lost=e=>{e.preventDefault();host.dispatchEvent(new CustomEvent('galleryfailure'))};gl.canvas.addEventListener('webglcontextlost',lost);
 return()=>{dead=true;cancelAnimationFrame(raf);clean.forEach(f=>f());ro.disconnect();visibility.disconnect();gl.canvas.removeEventListener('webglcontextlost',lost);geometry.remove();programs.forEach(p=>p.remove());textures.forEach(t=>gl.deleteTexture(t.texture));gl.getExtension('WEBGL_lose_context')?.loseContext();gl.canvas.remove()};
};
