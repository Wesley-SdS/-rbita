/* Presença neural: membrana óptica leve, ramificações orgânicas e impulsos.
   Interpretação artística de atividade neural, não um modelo biológico.
   WebGL nativo; Canvas 2D permanece como fallback. Nenhuma captura de áudio. */
(() => {
  'use strict';
  const Fallback=window.PresenceOrb,TAU=Math.PI*2;
  const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  function mul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
  function matrix(s=1,rx=0,ry=0,rz=0,x=0,y=0,z=0){const X=identity(),Y=identity(),Z=identity(),S=identity();X[5]=X[10]=Math.cos(rx);X[6]=Math.sin(rx);X[9]=-Math.sin(rx);Y[0]=Y[10]=Math.cos(ry);Y[2]=-Math.sin(ry);Y[8]=Math.sin(ry);Z[0]=Z[5]=Math.cos(rz);Z[1]=Math.sin(rz);Z[4]=-Math.sin(rz);S[0]=S[5]=S[10]=s;const m=mul(Z,mul(Y,mul(X,S)));m[12]=x;m[13]=y;m[14]=z;return m;}
  function perspective(aspect){const f=1/Math.tan(.7/2),n=.1,z=30;return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(z+n)/(n-z),-1,0,0,2*z*n/(n-z),0]);}
  const VERTEX=`
attribute vec3 aPosition;attribute vec3 aNormal;attribute vec2 aUv;
uniform mat4 uModel;uniform mat4 uVP;uniform float uPoint;uniform float uPixel;
uniform float uTime;uniform float uKind;uniform float uEnergy;uniform float uState;uniform float uPulse;
varying vec3 vPosition;varying vec3 vNormal;varying vec3 vLocal;varying vec2 vUv;
void main(){
  vec3 p=aPosition;float t=uTime;
  if(uKind!=1.&&uKind!=5.){
    float breath=sin(t*1.45)*.018;
    float wave=sin(p.x*4.+t*1.3)*sin(p.y*3.-t*.85)*sin(p.z*3.+t*.9)*.014;
    if(uState>.5&&uState<1.5){breath+=sin(t*2.8)*.025;p.y*=1.035+sin(t*2.)*.016;}
    if(uState>1.5&&uState<2.5)wave+=sin(p.x*5.+t*3.4)*cos(p.y*4.-t*2.1)*.025;
    if(uState>2.5&&uState<3.5){breath+=(sin(t*7.)*.048+sin(t*11.3)*.025)*uEnergy;wave*=2.2;}
    if(uState>6.5&&uState<7.5)breath+=pow(max(0.,sin(t*1.8)),5.)*.052;
    if(uState>7.5&&uState<8.5){breath*=.3;wave*=.2;}
    if(uState>8.5){breath-=pow(max(0.,sin(t*1.7)),7.)*.035;wave*=.5;}
    p*=1.+breath+wave*uEnergy+uPulse*.065;
  }
  vec4 world=uModel*vec4(p,1.);vPosition=world.xyz;vLocal=p;vNormal=normalize(mat3(uModel)*aNormal);vUv=aUv;
  gl_Position=uVP*world;
  float activation=pow(max(0.,sin(t*(1.6+uEnergy)+aUv.y*6.283-aUv.x*4.)),10.);
  gl_PointSize=clamp(uPoint*uPixel*(.65+activation*.7+uPulse*.6)/max(.3,gl_Position.w),1.,100.);
}`;
  const FRAGMENT=`
precision highp float;
varying vec3 vPosition;varying vec3 vNormal;varying vec3 vLocal;varying vec2 vUv;
uniform vec3 uColor;uniform vec3 uCamera;uniform vec2 uAttention;
uniform float uTime;uniform float uKind;uniform float uEnergy;uniform float uState;uniform float uDark;uniform float uOpacity;uniform float uPulse;
float signal(float distance,float family){
  float speed=.36;float direction=-1.;float spread=18.;
  if(uState>.5&&uState<1.5){speed=.72;direction=1.;spread=21.;}
  if(uState>1.5&&uState<2.5){speed=1.05;spread=26.;}
  if(uState>2.5&&uState<3.5){speed=.85;spread=12.;}
  if(uState>3.5&&uState<4.5){speed=.7;spread=26.;}
  if(uState>5.5&&uState<6.5){speed=1.2;spread=23.;}
  if(uState>7.5){speed=.16;spread=22.;}
  float phase=fract(uTime*speed+distance*direction*.78+family);
  float head=exp(-pow((phase-.45)*spread,2.));
  float tail=exp(-pow((phase-.33)*9.,2.))*.25;
  float group=.55+.45*sin(family*18.+uTime*1.9);
  return clamp((head+tail)*(.45+uEnergy)*group+uPulse*(.4+.6*head),0.,1.5);
}
void main(){
  vec3 color=mix(uColor,vec3(.8,1.,.91),.22);
  float activity=signal(vUv.x,vUv.y);
  float focus=exp(-length(vPosition.xy-uAttention)*4.)*.17;
  if(uKind>5.5){
    float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
    float glow=exp(-d*d*6.5);float core=exp(-d*d*45.);
    if(uKind>6.5){gl_FragColor=vec4(mix(color,vec3(1.),.7),glow*.15*uOpacity);return;}
    vec3 hue=mix(color*.58,vec3(.94,1.,.91),core);
    if(uDark>.5)hue=mix(color,vec3(.94,1.,.91),.25+core*.65);
    gl_FragColor=vec4(hue,(glow*(.28+activity*.92+uPulse*.5)+core*.6)*uOpacity);return;
  }
  vec3 N=normalize(vNormal),V=normalize(uCamera-vPosition);if(!gl_FrontFacing)N=-N;
  float nv=max(0.,dot(N,V)),fresnel=pow(1.-nv,3.);
  vec3 L=normalize(vec3(-.75,1.3,1.5)),R=reflect(-V,N);
  float diff=max(0.,dot(N,L)),highlight=pow(max(0.,dot(reflect(-L,N),V)),55.);
  float silk=pow(max(0.,dot(R,normalize(vec3(-.6,1.,1.2)))),22.);
  float rim=pow(max(0.,dot(N,normalize(vec3(-.7,.95,.4)))),36.);
  if(uKind<.5){
    float cloud=.5+.5*sin(vLocal.x*4.+uTime*.3)*sin(vLocal.y*5.-uTime*.2)*cos(vLocal.z*4.);
    vec3 pearl=mix(vec3(.69,.82,.74),color,.24);pearl=mix(pearl,vec3(.9,1.,.94),diff*.65+silk*.2);
    if(uDark>.5)pearl=mix(color*.24,color*.7,diff);
    gl_FragColor=vec4(pearl,(.065+fresnel*.12+cloud*.045)*uOpacity);return;
  }
  if(uKind<1.5){
    vec3 thread=mix(vec3(.43,.59,.51),color,.34);if(uDark>.5)thread=mix(color,vec3(.85,1.,.92),.25);
    thread=mix(thread,vec3(.95,1.,.96),highlight*.8);
    gl_FragColor=vec4(thread,(.54+silk*.28+activity*.16)*uOpacity*(1.+uDark*.35));return;
  }
  if(uKind<2.5){
    vec3 nerve=mix(vec3(.15,.38,.28),color*.52,.35);
    if(uDark>.5)nerve=mix(color,vec3(.86,1.,.91),.3);
    nerve*=.75+diff*.35;
    nerve=mix(nerve,mix(color,vec3(.9,1.,.91),.15),clamp(activity+focus,0.,1.));
    float depth=clamp((vPosition.z+.8)/1.6,0.,1.);
    vec3 distant=mix(vec3(.68,.79,.70),color,.12);if(uDark>.5)distant=color*.36;
    nerve=mix(distant,nerve,.3+depth*.7);
    nerve+=vec3(.5)*highlight+color*uPulse*.15;
    float vessel=mix(.24,.76,depth)+activity*.36+focus+uPulse*.2;
    gl_FragColor=vec4(nerve,clamp(vessel,.1,.97)*uOpacity);return;
  }
  if(uKind<3.5){
    vec3 shell=mix(vec3(.36,.63,.47),color,.18);
    if(uDark>.5)shell=mix(color,vec3(.87,1.,.94),.25);
    shell=mix(shell,vec3(.97,1.,.98),silk*.65+rim*.55);
    float band=pow(max(0.,dot(N,normalize(vec3(.9,-.15,.45)))),80.);
    float alpha=.017+fresnel*.22+silk*.13+rim*.21+band*.12;
    gl_FragColor=vec4(shell,alpha*uOpacity*(1.+uDark*1.3));return;
  }
  gl_FragColor=vec4(mix(color,vec3(.91,1.,.92),.3),uOpacity*(.3+activity*.7));
}`;
  function sphere(){const vertices=[],indices=[],w=64,h=36;for(let y=0;y<=h;y++)for(let x=0;x<=w;x++){const a=x/w*TAU,b=y/h*Math.PI,s=Math.sin(b),nx=Math.cos(a)*s,ny=Math.cos(b),nz=Math.sin(a)*s;vertices.push(nx,ny,nz,nx,ny,nz,x/w,y/h);}for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=y*(w+1)+x,b=a+w+1;indices.push(a,a+1,b,b,a+1,b+1);}return{vertices,indices};}
  function torus(radius,tube,arc=TAU){const vertices=[],indices=[],aCount=132,bCount=6;for(let a=0;a<=aCount;a++)for(let b=0;b<=bCount;b++){const u=a/aCount*arc,v=b/bCount*TAU,c=Math.cos(u),s=Math.sin(u),cv=Math.cos(v),sv=Math.sin(v);vertices.push((radius+tube*cv)*c,(radius+tube*cv)*s,tube*sv,cv*c,cv*s,sv,a/aCount,b/bCount);}for(let a=0;a<aCount;a++)for(let b=0;b<bCount;b++){const p=a*(bCount+1)+b,q=p+bCount+1;indices.push(p,q,p+1,q,q+1,p+1);}return{vertices,indices};}
  const norm=p=>{const d=Math.hypot(...p)||1;return p.map(x=>x/d);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const lerp=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
  function bezier(a,b,c,d,t){const s=1-t;return a.map((x,i)=>x*s*s*s+3*b[i]*s*s*t+3*c[i]*s*t*t+d[i]*t*t*t);}
  function neuralGeometry(){
    const paths=[],joints=[];
    function curve(a,b,c,d,family,radius,offset=0){const points=[];for(let i=0;i<=28;i++){const t=i/28,p=bezier(a,b,c,d,t),w=Math.sin(Math.PI*t)*.014;p[0]+=Math.sin(t*10+family*7)*w;p[2]+=Math.cos(t*9+family*5)*w;points.push(p);}paths.push({points,family,radius,offset});joints.push({p:points[18],distance:.65+offset,family},{p:d,distance:1+offset,family});return points;}
    // Branching pathways inhabit two soft lobes; there is no polygonal wire cage.
    for(let i=0;i<18;i++){
      const side=i%2?1:-1,k=Math.floor(i/2),angle=k*2.399963,lat=(k+.7)/9.5*Math.PI;
      const end=[side*(.16+.62*Math.sin(lat)*(.82+.18*Math.cos(angle))),Math.cos(lat)*.73,Math.sin(angle)*Math.sin(lat)*.62];
      const start=[side*.065,-.15+k*.045,Math.sin(angle)*.13],c1=[side*.22,.13,Math.cos(angle)*.2],c2=[end[0]*.76,end[1]*.8+.13,end[2]*.8];
      const trunk=curve(start,c1,c2,end,i*.071,.0058);
      for(let j=0;j<3;j++){
        const t=.34+j*.17,a=trunk[Math.round(t*28)],ang=angle+(j-1)*.75,branch=[side*(.25+.5*Math.sin(lat)),Math.max(-.78,Math.min(.78,end[1]+(j-1)*.19)),Math.sin(ang)*.65];
        const len=Math.hypot(...branch);if(len>.91)branch.forEach((v,n)=>branch[n]=v*.91/len);
        const b=lerp(a,branch,.35);b[1]+=.13;const c=lerp(a,branch,.75);c[2]+=Math.cos(ang)*.1;
        curve(a,b,c,branch,i*.071+j*.035,.0032,t*.55);
      }
    }
    // Curved surface pathways evoke cortical folds without imitating anatomy.
    for(const side of [-1,1])for(let row=0;row<9;row++){
      const y=-.63+row*.155,rad=Math.sqrt(1-y*y),points=[];
      for(let i=0;i<=42;i++){const a=-1.45+i/42*2.9;points.push([side*(.10+.69*Math.cos(a)*rad),y+.045*Math.sin(a*5+row)+.023*Math.sin(a*10+row),Math.sin(a)*rad*.76]);}
      paths.push({points,family:row*.145+(side>0?.23:0),radius:.0037,offset:.1});
    }
    for(let i=0;i<12;i++){const y=-.35+i*.06,z=Math.sin(i*1.6)*.42;curve([-.5,y,z],[-.18,y+.15,z+.16],[.18,y-.12,z+.2],[.5,y+.04,z],i*.095,.0031,.3);}
    const vertices=[],indices=[];let base=0;
    for(const path of paths){const {points,radius,family,offset}=path,sides=5;
      for(let i=0;i<points.length;i++){
        const p=points[i],prev=points[Math.max(0,i-1)],next=points[Math.min(points.length-1,i+1)],tangent=norm(next.map((v,n)=>v-prev[n]));
        const normal=norm(cross(tangent,Math.abs(tangent[1])>.9?[1,0,0]:[0,1,0])),binormal=cross(tangent,normal),t=i/(points.length-1);
        const r=radius*1.6*(.4+.6*Math.sin(Math.PI*t));
        for(let j=0;j<=sides;j++){const a=j/sides*TAU,n=normal.map((v,k)=>v*Math.cos(a)+binormal[k]*Math.sin(a));vertices.push(...p.map((v,k)=>v+n[k]*r),...n,t*.8+offset,family);}
      }
      for(let i=0;i<points.length-1;i++)for(let j=0;j<sides;j++){const a=base+i*(sides+1)+j,b=a+sides+1;indices.push(a,a+1,b,b,a+1,b+1);}
      base+=points.length*(sides+1);
    }
    const nodeVertices=[];for(const j of joints)nodeVertices.push(...j.p,...norm(j.p),j.distance,j.family);
    return{veins:{vertices,indices},nodes:{vertices:nodeVertices},paths};
  }
  class LivingOrb{
    constructor(canvas,gl){
      this.canvas=canvas;this.gl=gl;this.state='idle';this.intensity=.85;this.energy=.5;this.hue=[65/255,212/255,162/255];
      canvas.orbitaPresence=this;this.frameCount=0;
      this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.time=0;this.spin=0;this.last=0;this.lastDraw=0;this.frameId=0;this.visible=true;this.dirty=true;
      this.pointer={x:0,y:0};this.tilt={x:0,y:0};this.impulse=0;this.contextLost=false;
      this.init();canvas.dataset.renderer='webgl';canvas.dataset.identity='neural-organic';canvas.setAttribute('role','button');canvas.tabIndex=0;
      canvas.title='A presença acompanha seu gesto. Mova o cursor; clique ou pressione Enter para provocar uma reação.';
      canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();this.pointer={x:(e.clientX-r.left)/r.width-.5,y:(e.clientY-r.top)/r.height-.5};this.dirty=true;this.schedule();});
      canvas.addEventListener('pointerleave',()=>{this.pointer={x:0,y:0};this.dirty=true;this.schedule();});
      canvas.addEventListener('click',()=>this.energize());canvas.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.energize();}});
      canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;cancelAnimationFrame(this.frameId);});
      canvas.addEventListener('webglcontextrestored',()=>{this.contextLost=false;this.init();this.resize();});
      this.ro=new ResizeObserver(()=>this.resize());this.ro.observe(canvas);
      this.io=new IntersectionObserver(([e])=>{this.visible=e.isIntersecting;this.schedule();});this.io.observe(canvas);
      document.addEventListener('visibilitychange',()=>this.schedule());this.resize();
    }
    init(){
      const gl=this.gl,compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
      const vs=compile(gl.VERTEX_SHADER,VERTEX),fs=compile(gl.FRAGMENT_SHADER,FRAGMENT),program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.deleteShader(vs);gl.deleteShader(fs);this.program=program;
      this.locations={};['uModel','uVP','uPoint','uPixel','uColor','uCamera','uTime','uKind','uEnergy','uState','uDark','uOpacity','uPulse','uAttention'].forEach(n=>this.locations[n]=gl.getUniformLocation(program,n));
      this.attributes=['aPosition','aNormal','aUv'].map(n=>gl.getAttribLocation(program,n));
      const neural=neuralGeometry();
      this.meshes={sphere:this.mesh(sphere()),veins:this.mesh(neural.veins),nodes:this.mesh(neural.nodes),ring:this.mesh(torus(1.18,.0065,TAU*.97)),arc:this.mesh(torus(1.12,.005,TAU*.68)),wave:this.mesh(torus(1.02,.0034)),glow:this.mesh({vertices:[0,0,0,0,0,1,.4,.5]})};
      const motes=[];for(let i=0;i<24;i++){const y=1-i/23*2,r=Math.sqrt(1-y*y),a=i*2.399963;motes.push(Math.cos(a)*r*.97,y*.97,Math.sin(a)*r*.97,0,0,1,i/24,i*.19);}
      this.meshes.motes=this.mesh({vertices:motes});
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
    }
    mesh({vertices,indices}){const gl=this.gl,v=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);let index=null;if(indices){index=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);}return{v,index,count:indices?indices.length:vertices.length/8};}
    energize(){this.impulse=1;this.canvas.dataset.pulse=String(Date.now());this.dirty=true;this.schedule();}
    setState(mode){if(!window.ORBITA_STATES[mode])return;if(this.state!==mode&&!this.reduced)this.impulse=Math.max(this.impulse,.38);this.state=mode;this.dirty=true;this.canvas.setAttribute('aria-label','Órbita 3D: '+window.ORBITA_STATES[mode].label+'. Presença neural interativa.');this.schedule();}
    setReduced(value){this.reduced=value;this.dirty=true;this.schedule();}
    resize(){const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height||this.contextLost)return;this.width=r.width;this.height=r.height;this.dpr=Math.min(devicePixelRatio||1,1.4);this.canvas.width=Math.round(r.width*this.dpr);this.canvas.height=Math.round(r.height*this.dpr);this.gl.viewport(0,0,this.canvas.width,this.canvas.height);this.dirty=true;this.draw();this.schedule();}
    schedule(){cancelAnimationFrame(this.frameId);if(!this.visible||document.hidden||this.contextLost){this.last=0;return;}this.frameId=requestAnimationFrame(t=>this.frame(t));}
    frame(now){if(!this.visible||document.hidden||this.contextLost)return;const dt=this.last?Math.min((now-this.last)/1000,.07):.016;this.last=now;if(!this.reduced){this.time+=dt;this.spin+=dt*window.ORBITA_STATES[this.state].speed*(.55+this.intensity);this.impulse=Math.max(0,this.impulse-dt*.75);}if(now-this.lastDraw>=(this.state==='idle'?1000/24:1000/30)||this.dirty){if(!this.reduced||this.dirty)this.draw();this.lastDraw=now;this.dirty=false;}if(!this.reduced)this.frameId=requestAnimationFrame(t=>this.frame(t));}
    drawMesh(name,model,kind,opacity=1,point=1,color=this.hue){const gl=this.gl,m=this.meshes[name],l=this.locations;gl.bindBuffer(gl.ARRAY_BUFFER,m.v);const sizes=[3,3,2],offsets=[0,12,24];this.attributes.forEach((a,i)=>{if(a>=0){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,sizes[i],gl.FLOAT,false,32,offsets[i]);}});gl.uniformMatrix4fv(l.uModel,false,model);gl.uniform1f(l.uKind,kind);gl.uniform1f(l.uOpacity,opacity);gl.uniform1f(l.uPoint,point);gl.uniform3fv(l.uColor,color);if(m.index){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.index);gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0);}else gl.drawArrays(gl.POINTS,0,m.count);}
    draw(){
      if(!this.width||this.contextLost)return;this.frameCount++;const gl=this.gl,l=this.locations,cfg=window.ORBITA_STATES[this.state],s=this.state,t=this.reduced?2.3:this.time,spin=this.reduced?.6:this.spin,ease=this.reduced?1:.09;
      this.energy+=(cfg.energy*(.5+this.intensity*.8)-this.energy)*ease;this.hue=this.hue.map((v,i)=>v+(cfg.hue[i]/255-v)*ease);this.tilt.x+=(this.pointer.x-this.tilt.x)*.08;this.tilt.y+=(this.pointer.y-this.tilt.y)*.08;
      const pulse=this.reduced?0:this.impulse,camera=[0,.05,this.width<420?4.1:3.95],view=identity();view[13]=-camera[1];view[14]=-camera[2];
      gl.useProgram(this.program);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniformMatrix4fv(l.uVP,false,mul(perspective(this.width/this.height),view));gl.uniform3fv(l.uCamera,camera);gl.uniform1f(l.uPixel,this.canvas.height/470);gl.uniform1f(l.uTime,t);gl.uniform1f(l.uEnergy,this.energy);gl.uniform1f(l.uPulse,pulse);gl.uniform1f(l.uDark,document.documentElement.dataset.theme==='dark'?1:0);gl.uniform1f(l.uState,Object.keys(window.ORBITA_STATES).indexOf(s));gl.uniform2f(l.uAttention,this.tilt.x*2.4,-this.tilt.y*2.4);
      const orientation=.32+Math.sin(t*.3)*.24+this.tilt.x*.95;
      const lift=s==='success'?Math.pow(Math.max(0,Math.sin(t*1.8)),3)*.08:0;
      const base=matrix(s==='attention'?.97:1,.08+this.tilt.y*.65,orientation,Math.sin(t*.25)*.045,this.tilt.x*.04,Math.sin(t*1.05)*.025+lift,0);
      gl.depthMask(false);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT);this.drawMesh('sphere',base,3,.6);gl.disable(gl.CULL_FACE);
      this.drawMesh('sphere',mul(base,matrix(.68,0,spin*.035)),0,.75);
      this.drawMesh('sphere',mul(base,matrix(.88,0,-spin*.025)),0,.7);
      gl.depthMask(true);this.drawMesh('veins',base,2,.85);gl.depthMask(false);
      this.drawMesh('nodes',base,6,.95,43+this.energy*15);
      this.drawMesh('motes',mul(base,matrix(1,0,spin*.07)),6,.36,16);
      gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);this.drawMesh('sphere',base,3,1);gl.disable(gl.CULL_FACE);
      // Two hairline optical orbits: an accent, never a structural cage.
      this.drawMesh('ring',mul(base,matrix(1,.9+Math.sin(t*.3)*.07,.15+spin*.045,-.28)),1,1);
      this.drawMesh('ring',mul(base,matrix(.94,-.65,.85+Math.sin(t*.2)*.2,spin*-.06)),1,.82);
      if(s==='listening'||s==='speaking')for(let i=0;i<3;i++){const p=(t*.45+i/3)%1,scale=s==='listening'?1.27-p*.31:1+p*.34;this.drawMesh('wave',matrix(scale,.13,0,0),5,Math.sin(p*Math.PI)*.28*this.intensity);}
      if(s==='thinking')this.drawMesh('arc',mul(base,matrix(.91,1.17,spin*.35,spin*.4)),1,.55);
      if(s==='searching'){const scan=Math.sin(t*1.5);this.drawMesh('wave',matrix(Math.sqrt(1-scan*scan)*.94+.02,1.57,0,0,0,scan*.9,0),5,.45);this.drawMesh('arc',matrix(1.05,.7,.2,t*.55),1,.7);}
      if(s==='connecting'||s==='executing')for(let i=0;i<3;i++){const p=(t*(s==='executing'?.8:.4)+i/3)%1;this.drawMesh('arc',matrix(.82+p*.42,.5+i*.6,spin*.2,-spin*.2+i),5,(1-p)*.38);}
      if(s==='attention')this.drawMesh('wave',matrix(1.1,.3,0,0),1,.55);
      if(s==='success'||pulse>0){const p=pulse>0?1-pulse:(t*.38)%1;this.drawMesh('wave',matrix(.88+p*.57,.3,0,0),5,(1-p)*.36);}
      if(s==='error')this.drawMesh('arc',matrix(1.08,.3,0,Math.sin(t)*.09),1,.3);
      this.drawMesh('glow',matrix(1,0,0,0,0,0,.3),7,.55+pulse*.4,350);
      gl.depthMask(true);
    }
  }
  window.PresenceOrb=class{
    constructor(canvas){let gl;try{gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});}catch{}
      if(!gl){canvas.dataset.renderer='canvas-fallback';return new Fallback(canvas);}
      try{return new LivingOrb(canvas,gl);}catch(error){console.warn('Órbita: usando renderização de compatibilidade.',error.message);const replacement=canvas.cloneNode();canvas.replaceWith(replacement);replacement.dataset.renderer='canvas-fallback';return new Fallback(replacement);}
    }
  };
})();
