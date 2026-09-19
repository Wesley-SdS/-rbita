/* Geometria 3D real em WebGL: vidro, metal, núcleo emissivo e giroscópios.
   Sem CDN. O renderer Canvas continua disponível se WebGL não for suportado. */
(() => {
  'use strict';
  const Fallback=window.PresenceOrb, TAU=Math.PI*2;
  const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  function mul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
  function matrix(scale=1,rx=0,ry=0,rz=0,x=0,y=0,z=0){
    const X=identity(),Y=identity(),Z=identity(),S=identity();
    X[5]=X[10]=Math.cos(rx);X[6]=Math.sin(rx);X[9]=-Math.sin(rx);
    Y[0]=Y[10]=Math.cos(ry);Y[2]=-Math.sin(ry);Y[8]=Math.sin(ry);
    Z[0]=Z[5]=Math.cos(rz);Z[1]=Math.sin(rz);Z[4]=-Math.sin(rz);
    S[0]=S[5]=S[10]=scale;const out=mul(Z,mul(Y,mul(X,S)));out[12]=x;out[13]=y;out[14]=z;return out;
  }
  function perspective(aspect){const f=1/Math.tan(.7/2),n=.1,far=30;return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+n)/(n-far),-1,0,0,2*far*n/(n-far),0]);}
  const VERTEX=`
    attribute vec3 aPosition; attribute vec3 aNormal; attribute vec2 aUv;
    uniform mat4 uModel; uniform mat4 uVP; uniform float uPoint; uniform float uPixel;
    varying vec3 vPosition; varying vec3 vNormal; varying vec3 vLocal; varying vec2 vUv;
    void main(){ vec4 world=uModel*vec4(aPosition,1.); vPosition=world.xyz;
      vNormal=normalize(mat3(uModel)*aNormal);vLocal=aPosition;vUv=aUv;
      gl_Position=uVP*world;gl_PointSize=clamp(uPoint*uPixel/max(.3,gl_Position.w),1.,160.);
    }`;
  const FRAGMENT=`
    precision highp float;
    varying vec3 vPosition;varying vec3 vNormal;varying vec3 vLocal;varying vec2 vUv;
    uniform vec3 uColor;uniform vec3 uCamera;uniform float uTime;uniform float uKind;
    uniform float uEnergy;uniform float uState;uniform float uDark;uniform float uOpacity;
    const float PI=3.14159265;
    float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
    float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
    vec3 environment(vec3 direction){
      float ceiling=smoothstep(-.15,.8,direction.y);
      vec3 low=mix(vec3(.1,.19,.16),vec3(.008,.025,.035),uDark);
      vec3 high=mix(vec3(.85,.96,.87),vec3(.18,.36,.32),uDark);
      vec3 env=mix(low,high,ceiling);
      float softbox=pow(max(0.,dot(direction,normalize(vec3(-.6,1.,1.2)))),22.);
      float strip=pow(max(0.,dot(direction,normalize(vec3(1.,.35,.65)))),70.);
      return env+vec3(1.6,1.8,1.65)*softbox+vec3(.4,1.1,1.35)*strip;
    }
    vec3 light(vec3 N,vec3 V,vec3 L,vec3 tint,float roughness,vec3 albedo,float metal){
      vec3 H=normalize(V+L);float nv=max(dot(N,V),.001),nl=max(dot(N,L),.001),nh=max(dot(N,H),.001),hv=max(dot(H,V),.001);
      float a=roughness*roughness,a2=a*a,denom=nh*nh*(a2-1.)+1.;
      float distribution=a2/(PI*denom*denom+.0001);float k=(roughness+1.)*(roughness+1.)/8.;
      float geometry=(nv/(nv*(1.-k)+k))*(nl/(nl*(1.-k)+k));
      vec3 F0=mix(vec3(.04),albedo,metal);vec3 F=F0+(1.-F0)*pow(1.-hv,5.);
      vec3 spec=distribution*geometry*F/(4.*nv*nl+.001);
      return ((1.-F)*(1.-metal)*albedo/PI+spec)*tint*nl;
    }
    void main(){
      if(uKind>5.5){vec2 q=gl_PointCoord-.5;float d=length(q)*2.;if(d>1.)discard;
        if(uKind>6.5){float a=exp(-d*d*8.)*.22*uOpacity;gl_FragColor=vec4(uColor,a);}
        else{float a=pow(1.-d,2.)*uOpacity;gl_FragColor=vec4(mix(uColor,vec3(1.),pow(1.-d,8.)),a);}return;}
      vec3 N=normalize(vNormal),V=normalize(uCamera-vPosition);if(!gl_FrontFacing)N=-N;
      float nv=max(dot(N,V),0.);float fresnel=pow(1.-nv,3.5);
      float flow=noise(vLocal*4.+vec3(0.,uTime*.09,0.));
      vec3 albedo=uColor*.09+vec3(.018,.032,.036);float rough=.22,metal=.78,alpha=1.;vec3 emission=vec3(0.);
      if(uKind<.5){
        albedo=mix(vec3(.006,.022,.021),uColor*.065,.35);rough=.2;metal=.87;
        float longitude=atan(vLocal.z,vLocal.x),latitude=asin(clamp(vLocal.y,-1.,1.));
        float filament=pow(max(0.,1.-abs(sin(longitude*9.+latitude*8.+flow*5.-uTime*.24))),26.);
        float micro=pow(max(0.,sin(latitude*62.+flow*3.)),22.)*.17;
        emission=uColor*(filament*(.8+uEnergy*1.2)+micro);
        float cut=smoothstep(.42,.85,nv);alpha=1.;
        emission+=uColor*cut*.08;
      }else if(uKind<1.5){
        albedo=mix(vec3(.38,.48,.44),uColor*.4,.25);rough=.18;metal=.97;
        float panel=step(.28,fract(vUv.x*36.));albedo*=.55+.45*panel;
        emission=uColor*pow(max(0.,cos(vUv.y*6.28318)),28.)*(.6+uEnergy*.4);
      }else if(uKind<2.5){
        albedo=uColor*.6;rough=.15;metal=.4;
        float plasma=noise(vLocal*7.+uTime*.25);emission=uColor*(.18+pow(nv,3.)*2.2+plasma*.2)+vec3(.4)*pow(nv,8.);
      }else if(uKind<3.5){
        vec3 R=reflect(-V,N),T=refract(-V,N,1./1.46);
        vec3 env=environment(R),transmission=environment(T);
        vec3 reflection=mix(uColor*.045,env,.2+fresnel*.72);
        float rim=pow(max(0.,dot(N,normalize(vec3(-.7,.9,.6)))),46.);
        float line=pow(max(0.,dot(N,normalize(vec3(.95,.08,.3)))),100.);
        reflection+=vec3(1.3)*rim+uColor*line*.9;
        float innerDepth=clamp(1.-nv,0.,1.);reflection+=transmission*uColor*.025*innerDepth;
        alpha=.025+fresnel*.5+rim*.48+line*.42;
        gl_FragColor=vec4(pow(max(reflection,vec3(0.)),vec3(.8)),clamp(alpha,0.,.92)*uOpacity);return;
      }else if(uKind<4.5){gl_FragColor=vec4(uColor*(.7+uEnergy*.5),uOpacity);return;}
      else{
        float ring=1.-abs(vUv.y-.5)*2.;gl_FragColor=vec4(uColor,max(0.,ring)*uOpacity);return;
      }
      vec3 reflected=environment(reflect(-V,N));
      vec3 shaded=albedo*.16+reflected*mix(.18,.43,metal)*(fresnel*.7+.2);
      shaded+=light(N,V,normalize(vec3(-2.,3.,4.)),vec3(4.,4.5,4.1),rough,albedo,metal);
      shaded+=light(N,V,normalize(vec3(3.,.3,1.)),vec3(.3,1.5,1.8),rough+.1,albedo,metal);
      shaded+=light(N,V,normalize(vec3(-.5,-2.,-2.)),uColor*1.3,.4,albedo,metal);
      if(uKind<.5)shaded=albedo*.4+reflected*.018+uColor*fresnel*.12;
      shaded+=emission;
      if(uState>3.5&&uState<4.5){float sweep=sin(vPosition.y*5.-uTime*3.);shaded+=uColor*pow(max(sweep,0.),18.)*.8;}
      shaded=shaded/(shaded+vec3(.72));shaded=pow(shaded,vec3(.7));
      gl_FragColor=vec4(shaded,alpha*uOpacity);
    }`;
  function sphere(){const vertices=[],indices=[],w=72,h=40;for(let y=0;y<=h;y++)for(let x=0;x<=w;x++){
    const a=x/w*TAU,b=y/h*Math.PI,s=Math.sin(b),nx=Math.cos(a)*s,ny=Math.cos(b),nz=Math.sin(a)*s;
    vertices.push(nx,ny,nz,nx,ny,nz,x/w,y/h);
  }for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=y*(w+1)+x,b=a+w+1;indices.push(a,a+1,b,b,a+1,b+1);}return{vertices,indices};}
  function torus(radius,tube,arc=TAU){const vertices=[],indices=[],aCount=120,bCount=10;for(let a=0;a<=aCount;a++)for(let b=0;b<=bCount;b++){
    const u=a/aCount*arc,v=b/bCount*TAU,c=Math.cos(u),s=Math.sin(u),cv=Math.cos(v),sv=Math.sin(v);
    vertices.push((radius+tube*cv)*c,(radius+tube*cv)*s,tube*sv,cv*c,cv*s,sv,a/aCount,b/bCount);
  }for(let a=0;a<aCount;a++)for(let b=0;b<bCount;b++){const p=a*(bCount+1)+b,q=p+bCount+1;indices.push(p,q,p+1,q,q+1,p+1);}return{vertices,indices};}
  class Orb3D{
    constructor(canvas,gl){
      this.canvas=canvas;this.gl=gl;this.state='idle';this.intensity=.85;this.energy=.36;this.hue=[65/255,212/255,162/255];
      this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.time=0;this.spin=0;this.last=0;this.lastDraw=0;this.frameId=0;this.visible=true;this.dirty=true;
      this.pointer={x:0,y:0};this.tilt={x:0,y:0};this.impulse=0;this.contextLost=false;
      this.init();canvas.dataset.renderer='webgl';canvas.setAttribute('role','button');canvas.tabIndex=0;
      canvas.title='Mova o cursor para ver a profundidade. Clique ou pressione Enter para energizar.';
      canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();this.pointer={x:(e.clientX-r.left)/r.width-.5,y:(e.clientY-r.top)/r.height-.5};this.dirty=true;this.schedule();});
      canvas.addEventListener('pointerleave',()=>{this.pointer={x:0,y:0};this.dirty=true;this.schedule();});
      canvas.addEventListener('click',()=>this.energize());canvas.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.energize();}});
      canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;cancelAnimationFrame(this.frameId);});
      canvas.addEventListener('webglcontextrestored',()=>{this.contextLost=false;this.init();this.resize();});
      this.ro=new ResizeObserver(()=>this.resize());this.ro.observe(canvas);
      this.io=new IntersectionObserver(([e])=>{this.visible=e.isIntersecting;this.schedule();});this.io.observe(canvas);
      document.addEventListener('visibilitychange',()=>this.schedule());this.resize();
    }
    init(){const gl=this.gl;const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
      const vs=compile(gl.VERTEX_SHADER,VERTEX),fs=compile(gl.FRAGMENT_SHADER,FRAGMENT),program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.deleteShader(vs);gl.deleteShader(fs);this.program=program;
      this.locations={};['uModel','uVP','uPoint','uPixel','uColor','uCamera','uTime','uKind','uEnergy','uState','uDark','uOpacity'].forEach(n=>this.locations[n]=gl.getUniformLocation(program,n));
      this.attributes=['aPosition','aNormal','aUv'].map(n=>gl.getAttribLocation(program,n));
      this.meshes={sphere:this.mesh(sphere()),ring:this.mesh(torus(1.3,.025,TAU*.92)),inner:this.mesh(torus(.74,.037,TAU*.9)),arc:this.mesh(torus(1.13,.014,TAU*.72)),wave:this.mesh(torus(1.18,.008,TAU))};
      this.nodes=Array.from({length:132},(_,i)=>{const y=1-i/131*2,r=Math.sqrt(1-y*y),a=i*2.39996;return[Math.cos(a)*r*.88,y*.88,Math.sin(a)*r*.88];});
      const pointVertices=[],lineVertices=[];this.nodes.forEach((p,i)=>pointVertices.push(...p,...p,i/132,0));
      for(let i=0;i<this.nodes.length;i++)for(let j=i+1;j<this.nodes.length;j++){const a=this.nodes[i],b=this.nodes[j];if(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<.34)lineVertices.push(...a,...a,0,0,...b,...b,0,0);}
      this.meshes.nodes=this.mesh({vertices:pointVertices});this.meshes.lines=this.mesh({vertices:lineVertices});this.meshes.glow=this.mesh({vertices:[0,0,0,0,0,1,0,0]});
      const bars=[];for(let i=0;i<96;i++){const a=i/96*TAU;bars.push(Math.cos(a)*1.17,Math.sin(a)*1.17,0,0,0,1,i/96,0,Math.cos(a)*1.34,Math.sin(a)*1.34,0,0,0,1,i/96,1);}
      this.meshes.bars=this.mesh({vertices:bars});
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
    }
    mesh({vertices,indices}){const gl=this.gl,v=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);let index=null;if(indices){index=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);}return{v,index,count:indices?indices.length:vertices.length/8};}
    energize(){this.impulse=1;this.canvas.dataset.pulse=String(Date.now());this.dirty=true;this.schedule();}
    setState(mode){if(!window.ORBITA_STATES[mode])return;this.state=mode;this.dirty=true;this.canvas.setAttribute('aria-label',`Órbita 3D: ${window.ORBITA_STATES[mode].label}. Mova o cursor ou clique para interagir.`);this.schedule();}
    setReduced(value){this.reduced=value;this.dirty=true;this.schedule();}
    resize(){const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height||this.contextLost)return;this.width=rect.width;this.height=rect.height;this.dpr=Math.min(devicePixelRatio||1,1.4);this.canvas.width=Math.round(rect.width*this.dpr);this.canvas.height=Math.round(rect.height*this.dpr);this.gl.viewport(0,0,this.canvas.width,this.canvas.height);this.dirty=true;this.draw();this.schedule();}
    schedule(){cancelAnimationFrame(this.frameId);if(!this.visible||document.hidden||this.contextLost){this.last=0;return;}this.frameId=requestAnimationFrame(t=>this.frame(t));}
    frame(now){if(!this.visible||document.hidden||this.contextLost)return;const dt=this.last?Math.min((now-this.last)/1000,.07):.016;this.last=now;
      if(!this.reduced){this.time+=dt;this.spin+=dt*window.ORBITA_STATES[this.state].speed*(.6+this.intensity*1.1);this.impulse=Math.max(0,this.impulse-dt*.6);}
      if(now-this.lastDraw>=(this.state==='idle'?1000/24:1000/30)||this.dirty){if(!this.reduced||this.dirty)this.draw();this.lastDraw=now;this.dirty=false;}
      if(!this.reduced)this.frameId=requestAnimationFrame(t=>this.frame(t));
    }
    drawMesh(name,model,kind,opacity=1,primitive,point=1,color=this.hue){const gl=this.gl,m=this.meshes[name],l=this.locations;gl.bindBuffer(gl.ARRAY_BUFFER,m.v);const sizes=[3,3,2],offsets=[0,12,24];this.attributes.forEach((a,i)=>{if(a>=0){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,sizes[i],gl.FLOAT,false,32,offsets[i]);}});gl.uniformMatrix4fv(l.uModel,false,model);gl.uniform1f(l.uKind,kind);gl.uniform1f(l.uOpacity,opacity);gl.uniform1f(l.uPoint,point);gl.uniform3fv(l.uColor,color);if(m.index){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.index);gl.drawElements(primitive||gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0);}else gl.drawArrays(primitive||gl.POINTS,0,m.count);}
    draw(){if(!this.width||this.contextLost)return;const gl=this.gl,l=this.locations,cfg=window.ORBITA_STATES[this.state],s=this.state;
      const t=this.reduced?2.3:this.time,spin=this.reduced?.6:this.spin,ease=this.reduced?1:.085;
      this.energy+=(cfg.energy*(.45+this.intensity*.85)-this.energy)*ease;this.hue=this.hue.map((v,i)=>v+(cfg.hue[i]/255-v)*ease);this.tilt.x+=(this.pointer.x-this.tilt.x)*.07;this.tilt.y+=(this.pointer.y-this.tilt.y)*.07;
      const beat=s==='speaking'?(Math.sin(t*9)*.045+Math.sin(t*14)*.025)*this.intensity:Math.sin(t*1.5)*.012;
      const pulse=this.reduced?0:this.impulse,scale=1+beat+pulse*.045;
      const camera=[0,.1,this.width<420?4.25:4.1];const view=identity();view[13]=-camera[1];view[14]=-camera[2];
      gl.useProgram(this.program);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniformMatrix4fv(l.uVP,false,mul(perspective(this.width/this.height),view));gl.uniform3fv(l.uCamera,camera);gl.uniform1f(l.uPixel,this.canvas.height/470);gl.uniform1f(l.uTime,t);gl.uniform1f(l.uEnergy,this.energy);gl.uniform1f(l.uDark,document.documentElement.dataset.theme==='dark'?1:0);gl.uniform1f(l.uState,Object.keys(window.ORBITA_STATES).indexOf(s));
      const base=matrix(scale,.15+this.tilt.y*.85,spin*.18+this.tilt.x*1.1,Math.sin(t*.15)*.08);
      gl.depthMask(true);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      // Three solid, lit gyroscopes occupy different planes around the sphere.
      this.drawMesh('ring',mul(base,matrix(1,.72+Math.sin(t*.23)*.15,spin*.13,-.4)),1);
      this.drawMesh('ring',mul(base,matrix(.88,-.76,1.1+spin*.17,spin*-.21)),1,.93);
      this.drawMesh('arc',mul(base,matrix(1,1.35,-.3,spin*.4)),1);
      this.drawMesh('inner',mul(base,matrix(1,1.2+spin*.27,spin*-.32,.6)),1);
      this.drawMesh('inner',mul(base,matrix(.76,-.5,spin*.37,-.4)),1);
      this.drawMesh('sphere',mul(base,matrix(.25*(1+beat*2+pulse*.18))),2);
      for(let i=0;i<7;i++){const a=spin*.6+i*TAU/7,x=Math.cos(a)*1.3,y=Math.sin(a)*1.03,z=Math.sin(a)*.7;this.drawMesh('sphere',mul(base,matrix(.028,0,0,0,x,y,z)),2);}
      gl.depthMask(false);
      // Dark inner back wall gives transmission an actual depth reference, not the page color.
      gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT);
      this.drawMesh('sphere',mul(base,matrix(.88,spin*.05,spin*.16)),0,1);
      gl.disable(gl.CULL_FACE);
      this.drawMesh('lines',base,4,.21,gl.LINES);
      this.drawMesh('nodes',base,6,.86,gl.POINTS,19);
      const count=s==='thinking'||s==='executing'?25:9;
      for(let i=0;i<count;i++){const a=this.nodes[(i*13)%132],b=this.nodes[(i*13+17)%132],p=(t*(s==='thinking'?.65:.26)+i*.131)%1;this.drawMesh('glow',mul(base,matrix(1,0,0,0,a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p,a[2]+(b[2]-a[2])*p)),6,.9,gl.POINTS,20);}
      // Clearcoat is drawn back-to-front over the internal machinery.
      gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT);this.drawMesh('sphere',base,3,.55);gl.cullFace(gl.BACK);this.drawMesh('sphere',base,3,1);gl.disable(gl.CULL_FACE);
      if(s==='listening'||s==='speaking'){
        const radial=1+Math.sin(t*7)*.04+Math.sin(t*13)*.025;
        this.drawMesh('bars',matrix(radial,Math.sin(t*.5)*.18,Math.cos(t*.3)*.18,spin*.16),4,.58,gl.LINES);
        for(let i=0;i<2;i++){const p=(t*.55+i*.5)%1;this.drawMesh('wave',matrix(.95+p*.38,.2,0,0),5,(1-p)*.4);}
      }
      if(s==='searching'){this.drawMesh('arc',matrix(1.05,1.12,0,t*1.8),2,.85);this.drawMesh('wave',matrix(.75+Math.sin(t*1.3)*.2,1.57,0,0,0,Math.sin(t*1.3)*.72,0),4,.65);}
      if(s==='connecting'||s==='executing'){
        for(let i=0;i<4;i++){const a=i*TAU/4+spin*.15,p=(t*.7+i*.25)%1;this.drawMesh('sphere',matrix(.045,0,0,0,Math.cos(a)*1.5,Math.sin(a)*1.12,.1),2);this.drawMesh('glow',matrix(1,0,0,0,Math.cos(a)*1.5*p,Math.sin(a)*1.12*p,.1),6,.9,gl.POINTS,30);}
        if(s==='executing')this.drawMesh('arc',matrix(1.1,.2,0,spin*1.3),2,.8);
      }
      if(s==='attention'){this.drawMesh('wave',matrix(1.12,.13,0,0),1,.8);this.drawMesh('wave',matrix(1.18,.13,0,0),4,.35);}
      if(s==='error'){this.drawMesh('arc',matrix(1.07,.3,0,Math.floor(t*2)*.04),1,.7);}
      if(s==='success'||pulse>0){const p=pulse>0?1-pulse:(t*.45)%1;this.drawMesh('wave',matrix(.9+p*.55,.25,0,0),4,(1-p)*.7);}
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
      this.drawMesh('glow',matrix(1,0,0,0,0,0,.6),7,.43+pulse*.5,gl.POINTS,360*(1+beat*2));
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(true);
    }
  }
  window.PresenceOrb=class{
    constructor(canvas){let gl;try{gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});}catch{}
      if(!gl){canvas.dataset.renderer='canvas-fallback';return new Fallback(canvas);}
      try{return new Orb3D(canvas,gl);}catch(error){console.warn('Órbita: usando renderização de compatibilidade.',error.message);const replacement=canvas.cloneNode();canvas.replaceWith(replacement);replacement.dataset.renderer='canvas-fallback';return new Fallback(replacement);}
    }
  };
})();
