import { useRef, useEffect, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

// Superset dos estados do web (mobile usava "thinking" → mapeia p/ "studying").
export type OrbMode = "standby" | "listening" | "speaking" | "thinking" | "searching" | "connecting";

const mapMode = (m: OrbMode) => (m === "thinking" ? "studying" : m);

/**
 * Orb do celular — núcleo neural ÓRBITA IDÊNTICO ao web: roda o MESMO código
 * Canvas 2D (150 nós numa esfera, órbitas, núcleo espiral, efeitos por estado)
 * dentro de uma WebView transparente. Assim a identidade é pixel a pixel.
 */
export function Orb({ mode = "standby", size = 200 }: { mode?: OrbMode; size?: number }) {
  const ref = useRef<WebView>(null);

  const html = useMemo(
    () => ORB_HTML.replace("__INITIAL_MODE__", mapMode(mode)),
    [], // HTML fixo; o modo é atualizado via injectJavaScript
  );

  useEffect(() => {
    ref.current?.injectJavaScript(`window.__setMode && window.__setMode(${JSON.stringify(mapMode(mode))});true;`);
  }, [mode]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ html }}
        style={styles.web}
        originWhitelist={["*"]}
        scrollEnabled={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        androidLayerType="hardware"
        allowsInlineMediaPlayback
        javaScriptEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  web: { flex: 1, width: "100%", height: "100%", backgroundColor: "transparent" },
});

// ── HTML/Canvas: MESMA lógica do Orb web (apps/web/src/components/orb.tsx) ──
const ORB_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style>
</head><body><canvas id="c"></canvas><script>
(function(){
  var cv=document.getElementById('c'),ctx=cv.getContext('2d');
  var W=0,H=0,DPR=Math.min(window.devicePixelRatio||1,2);
  function size(){W=window.innerWidth;H=window.innerHeight;cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);}
  window.addEventListener('resize',size);size();
  var _gr=Math.PI*(3-Math.sqrt(5)),JN=150,jn=[];
  for(var i=0;i<JN;i++){var y=1-(i/(JN-1))*2,r=Math.sqrt(1-y*y),th=_gr*i;jn.push({x:Math.cos(th)*r,y:y,z:Math.sin(th)*r,big:Math.random()<0.16,ph:Math.random()*6.2832});}
  var je=[],_THR=0.32;
  for(var i2=0;i2<JN;i2++)for(var j=i2+1;j<JN;j++){var dx=jn[i2].x-jn[j].x,dy=jn[i2].y-jn[j].y,dz=jn[i2].z-jn[j].z,d=Math.sqrt(dx*dx+dy*dy+dz*dz);if(d<_THR)je.push({a:i2,b:j,d:d});}
  var orbits=[{ax:0,ay:0.9,rr:1.3,rz:0.55,spd:0.5},{ax:0.7,ay:0.2,rr:1.42,rz:0.42,spd:-0.35},{ax:-0.5,ay:0.5,rr:1.18,rz:0.62,spd:0.62}];
  var CFG={standby:{rot:0.11,energy:0.25},listening:{rot:0.16,energy:0.7},speaking:{rot:0.2,energy:1},searching:{rot:0.55,energy:0.9},studying:{rot:0.24,energy:0.85},connecting:{rot:0.3,energy:0.95}};
  var MODE="__INITIAL_MODE__";window.__setMode=function(m){if(CFG[m])MODE=m;};
  var energy=0.25,angY=0,angX=-0.32,coreAng=0,jt=0,spawnAcc=0,beatEnv=0,nextBeat=0,lastT=0,speakAmp=0,packets=[],ripples=[],rings=[];
  function jrot(p){var cyy=Math.cos(angY),syy=Math.sin(angY);var x=p.x*cyy+p.z*syy,z=-p.x*syy+p.z*cyy;var cxx=Math.cos(angX),sxx=Math.sin(angX);return{x:x,y:p.y*cxx-z*sxx,z:p.y*sxx+z*cxx};}
  function jproj(p,R,cx,cy){var s=3.2/(3.2-p.z);return{px:cx+p.x*s*R,py:cy+p.y*s*R,s:s,depth:(p.z+1)/2};}
  function draw(now){
    var dt=Math.min(((now||0)-lastT)/1000,0.05)||0.016;lastT=now||0;
    var cfg=CFG[MODE]||CFG.standby;jt+=dt;
    energy+=(cfg.energy-energy)*Math.min(dt*4,1);var E=energy;
    angY+=dt*cfg.rot;angX=-0.32+Math.sin(jt*0.15)*0.06;
    coreAng+=dt*(0.6+(MODE==="speaking"?1.4:0)+(MODE==="searching"?1.2:0))*(0.6+E);
    nextBeat-=dt;if(nextBeat<=0){beatEnv=1;nextBeat=MODE==="speaking"?0.12+Math.random()*0.22:0.5+Math.random()*0.6;}
    beatEnv*=Math.pow(0.02,dt);if(speakAmp>beatEnv)beatEnv=speakAmp;
    ctx.globalCompositeOperation="source-over";ctx.fillStyle="rgba(10,7,3,0.34)";ctx.fillRect(0,0,W,H);
    ctx.globalCompositeOperation="lighter";
    var cx=W/2,cy=H*0.5,R=Math.min(W,H)*0.3;
    var P=jn.map(function(n){return jproj(jrot(n),R,cx,cy);});
    for(var k=0;k<je.length;k++){var e=je[k],a=P[e.a],b=P[e.b],depth=(a.depth+b.depth)/2,al=0.05+depth*0.16;
      if(MODE==="studying")al+=0.1*Math.max(0,Math.sin(jt*2+e.a*0.3))*E;if(MODE==="connecting")al+=0.06*E;
      ctx.strokeStyle="rgba(255,168,74,"+al.toFixed(3)+")";ctx.lineWidth=0.6+depth*0.5;ctx.beginPath();ctx.moveTo(a.px,a.py);ctx.lineTo(b.px,b.py);ctx.stroke();}
    var sweepA=0;
    if(MODE==="searching"){sweepA=(jt*2.2)%6.2832;var gx=Math.cos(sweepA),gy=Math.sin(sweepA);var grad=ctx.createLinearGradient(cx-gx*R,cy-gy*R,cx+gx*R,cy+gy*R);grad.addColorStop(0,"rgba(255,170,60,0)");grad.addColorStop(0.5,"rgba(255,200,110,"+0.28*E+")");grad.addColorStop(1,"rgba(255,170,60,0)");ctx.strokeStyle=grad;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(cx-gx*R*1.3,cy-gy*R*1.3);ctx.lineTo(cx+gx*R*1.3,cy+gy*R*1.3);ctx.stroke();}
    for(var i3=0;i3<jn.length;i3++){var n=jn[i3],p=P[i3];var br=0.35+p.depth*0.5,sz=(n.big?2.4:1.3)*(0.55+p.depth*0.6);br+=0.25*Math.sin(jt*1.6+n.ph);
      var ang2d=Math.atan2(p.py-cy,p.px-cx),dist2d=Math.hypot(p.px-cx,p.py-cy)/R;
      if(MODE==="searching"){var da=Math.abs(((ang2d-sweepA+9.4248)%6.2832)-3.1416);da=Math.min(da,Math.abs(((ang2d-sweepA+12.5664)%6.2832)-3.1416));if(da<0.35){br+=(1-da/0.35)*1.4*E;sz*=1+(1-da/0.35)*1.1*E;}}
      if(MODE==="studying"){var f=Math.sin(jt*3-i3*0.4);if(f>0.85){br+=(f-0.85)*8*E;sz*=1.5;}}
      for(var ri=0;ri<ripples.length;ri++){var d2=Math.abs(dist2d-ripples[ri].r);if(d2<0.09){br+=(1-d2/0.09)*1.6*E;sz*=1+(1-d2/0.09)*0.9;}}
      if(MODE==="speaking"||MODE==="listening")br+=beatEnv*0.4*E;br=Math.max(0,Math.min(2.2,br));
      var col=n.big?"255,215,150":"255,180,90";var g=ctx.createRadialGradient(p.px,p.py,0,p.px,p.py,sz*5);g.addColorStop(0,"rgba("+col+","+(0.5*br).toFixed(3)+")");g.addColorStop(1,"rgba("+col+",0)");ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.px,p.py,sz*5,0,6.2832);ctx.fill();
      ctx.fillStyle="rgba(255,236,205,"+Math.min(1,0.6*br+0.2).toFixed(3)+")";ctx.beginPath();ctx.arc(p.px,p.py,sz,0,6.2832);ctx.fill();}
    for(var oi=0;oi<orbits.length;oi++){var o=orbits[oi];ctx.strokeStyle="rgba(255,190,90,"+(0.22+0.15*E).toFixed(3)+")";ctx.lineWidth=1.4;ctx.beginPath();var spin=jt*o.spd;
      for(var av=0;av<=64;av++){var th2=(av/64)*6.2832,ex=Math.cos(th2)*o.rr,ey=Math.sin(th2)*o.rz;var x1=ex*Math.cos(spin)-ey*Math.sin(spin),y1=ex*Math.sin(spin)+ey*Math.cos(spin);var y2=y1*Math.cos(o.ax),z2=y1*Math.sin(o.ax);var x3=x1*Math.cos(o.ay)+z2*Math.sin(o.ay),z3=-x1*Math.sin(o.ay)+z2*Math.cos(o.ay);var pp=jproj(jrot({x:x3,y:y2,z:z3}),R,cx,cy);av?ctx.lineTo(pp.px,pp.py):ctx.moveTo(pp.px,pp.py);}ctx.stroke();}
    if(MODE==="listening"){spawnAcc+=dt;if(spawnAcc>0.5){spawnAcc=0;rings.push({r:0.12,a:0.5});}}
    for(var rgi=rings.length-1;rgi>=0;rgi--){var rg=rings[rgi];rg.r+=dt*0.5;rg.a-=dt*0.4;if(rg.a<=0){rings.splice(rgi,1);continue;}ctx.strokeStyle="rgba(150,210,255,"+(rg.a*E).toFixed(3)+")";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cx,cy,rg.r*R*1.4,0,6.2832);ctx.stroke();}
    if(MODE==="connecting"){spawnAcc+=dt;if(spawnAcc>0.9){spawnAcc=0;ripples.push({r:0.05});}}
    for(var rpi=ripples.length-1;rpi>=0;rpi--){var rp=ripples[rpi];rp.r+=dt*0.9;if(rp.r>1.25){ripples.splice(rpi,1);continue;}var aa=Math.max(0,1-rp.r/1.25)*0.6*Math.max(E,0.4);ctx.strokeStyle="rgba(255,150,80,"+aa.toFixed(3)+")";ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,rp.r*R,0,6.2832);ctx.stroke();}
    if(MODE==="studying"){spawnAcc+=dt;if(spawnAcc>0.06&&packets.length<70){spawnAcc=0;packets.push({e:(Math.random()*je.length)|0,t:0,sp:0.8+Math.random()*1.2});}}
    for(var pki=packets.length-1;pki>=0;pki--){var pk=packets[pki];pk.t+=dt*pk.sp;if(pk.t>=1){packets.splice(pki,1);continue;}var e2=je[pk.e],a2=P[e2.a],b2=P[e2.b],x=a2.px+(b2.px-a2.px)*pk.t,y=a2.py+(b2.py-a2.py)*pk.t;var gg=ctx.createRadialGradient(x,y,0,x,y,6);gg.addColorStop(0,"rgba(180,255,160,0.9)");gg.addColorStop(1,"rgba(160,255,140,0)");ctx.fillStyle=gg;ctx.beginPath();ctx.arc(x,y,6,0,6.2832);ctx.fill();}
    var beat=MODE==="speaking"?beatEnv:0;var coreR=R*(0.2+0.03*Math.sin(jt*2)+beat*0.06);var cg=ctx.createRadialGradient(cx,cy,0,cx,cy,coreR*3.4);var ci=0.55+0.35*E+beat*0.4;
    cg.addColorStop(0,"rgba(255,244,220,"+Math.min(1,ci).toFixed(3)+")");cg.addColorStop(0.25,"rgba(255,190,90,"+(0.7*ci).toFixed(3)+")");cg.addColorStop(0.6,"rgba(255,140,50,"+(0.25*ci).toFixed(3)+")");cg.addColorStop(1,"rgba(255,120,40,0)");ctx.fillStyle=cg;ctx.beginPath();ctx.arc(cx,cy,coreR*3.4,0,6.2832);ctx.fill();
    for(var arm=0;arm<3;arm++){var off=(arm/3)*6.2832;for(var s2=0;s2<90;s2++){var tt=s2/90,th3=tt*2.4*6.2832+off+coreAng,rad=tt*coreR*1.35;var x4=cx+Math.cos(th3)*rad,y4=cy+Math.sin(th3)*rad*0.9,br2=(1-tt)*0.9,sz2=(1-tt)*2.4+0.4;ctx.fillStyle="rgba(255,"+(200-tt*40)+","+(150-tt*70)+","+br2.toFixed(3)+")";ctx.beginPath();ctx.arc(x4,y4,sz2,0,6.2832);ctx.fill();}}
    if(MODE==="speaking"||MODE==="listening"){var base=coreR*1.7,ampl=(MODE==="speaking"?0.55:0.3)*R*0.18*E;ctx.strokeStyle=MODE==="speaking"?"rgba(255,205,120,"+0.6*E+")":"rgba(150,210,255,"+0.55*E+")";ctx.lineWidth=2;ctx.beginPath();
      for(var aw=0;aw<=90;aw++){var th4=(aw/90)*6.2832;var m=Math.sin(th4*6+jt*8)*0.5+Math.sin(th4*11-jt*5)*0.3+Math.sin(th4*3+jt*3)*0.2;var rad2=base+m*ampl*(0.5+beatEnv);var x5=cx+Math.cos(th4)*rad2,y5=cy+Math.sin(th4)*rad2;aw?ctx.lineTo(x5,y5):ctx.moveTo(x5,y5);}ctx.closePath();ctx.stroke();}
    ctx.globalCompositeOperation="source-over";requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
</script></body></html>`;
