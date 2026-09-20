/* Núcleo holográfico: malha neural volumétrica, giroscópios e reações por operação.
   Canvas 2D sem WebGL. Ritmos de fala/escuta são demonstrativos, sem capturar áudio. */
(() => {
  'use strict';
  const TAU=Math.PI*2;
  const definitions={
    idle:{label:'Presença',status:'Núcleo ativo · aguardando seu comando',icon:'orbit',hue:[65,212,162],speed:.3,energy:.36,title:'O que vamos fazer hoje?',description:'Uma ideia, um plano ou só uma conversa. Estou com você.',note:"Serenidade: a membrana respira, flutua e acompanha seu gesto. Pequenos impulsos percorrem os veios. Clique para despertar uma reação que atravessa a presença."},
    listening:{label:'Escutando',status:'Canal de escuta aberto',icon:'mic',hue:[47,219,228],speed:.4,energy:.8,title:'Pode falar. Estou aqui.',description:'Escuta demonstrativa. Seu microfone continua desligado.',note:"Atenção: a forma se alonga delicadamente e ondas convergem para dentro. As conexões recebem impulsos, como uma presença que se aproxima para ouvir. Áudio demonstrativo."},
    thinking:{label:'Pensando',status:'Processando · conectando possibilidades',icon:'network',hue:[163,135,255],speed:.72,energy:.9,title:'Deixe eu ligar os pontos.',description:'Buscando sentido entre o que você disse e o que importa.',note:"Curiosidade: grupos de conexões se acendem em sequência, os sinais percorrem ramificações e a membrana apresenta pequenas ondulações localizadas."},
    speaking:{label:'Falando',status:'Transmitindo resposta',icon:'wave',hue:[91,236,186],speed:.46,energy:.95,title:'Encontrei um bom caminho.',description:'A estrutura inteira acompanha o ritmo de uma fala demonstrativa.',note:"Expressão: o volume inteiro ganha cadência, com expansões irregulares e ondas para fora. Os veios acompanham esse ritmo ilustrativo; não há análise de áudio real."},
    searching:{label:'Pesquisando',status:'Varredura de contexto em andamento',icon:'search',hue:[79,173,255],speed:.9,energy:.8,title:'Um olhar um pouco mais longe.',description:'Percorrendo as fontes do cenário de demonstração.',note:"Exploração: uma lâmina de luz atravessa o volume e ativa regiões internas. Os cards de fontes aparecem progressivamente, com links reais e descoberta simulada."},
    connecting:{label:'Conectando',status:'Estabelecendo conexões',icon:'plug',hue:[44,212,199],speed:.56,energy:.78,title:'Tudo começa a se conectar.',description:'Canais separados encontram um mesmo centro.',note:"Conexão: impulsos atravessam caminhos ramificados e ondas aproximam regiões distintas. Uma linguagem visual de sinapses, sem cabos ou peças pesadas."},
    executing:{label:'Executando',status:'Comando em execução · demonstração',icon:'flow',hue:[100,231,157],speed:1,energy:1,title:'Transformando intenção em ação.',description:'Acompanhe a execução visual. Nenhuma máquina real está conectada.',note:"Intenção: os sinais ganham velocidade e coordenação, formando sequências de ativação. A energia vem do movimento e da luz, com uma silhueta leve."},
    success:{label:'Concluído',status:'Execução concluída',icon:'check',hue:[156,245,115],speed:.34,energy:.9,title:'Feito. Mais espaço no seu dia.',description:'Um pulso de confirmação. Pronta para o próximo comando.',note:"Satisfação: a presença se expande, sobe levemente e libera uma onda suave de luz. Depois, encontra novamente seu ritmo de respiração."},
    attention:{label:'Sua decisão',status:'Aguardando autorização',icon:'shield',hue:[246,184,80],speed:.12,energy:.55,title:'O próximo passo é seu.',description:'Antes de agir, quero ter certeza de que você está de acordo.',note:"Cuidado: o volume se recolhe um pouco, a pulsação desacelera e um contorno âmbar permanece atento. A ação continua esperando sua autorização."},
    error:{label:'Imprevisto',status:'Interrupção detectada · recuperação disponível',icon:'refresh',hue:[245,120,94],speed:.16,energy:.5,title:'Uma pausa. Não um ponto final.',description:'Algo não saiu como esperado. Vamos por outro caminho?',note:"Hesitação: uma pequena retração interrompe o ritmo. A cor aquece, os impulsos desaceleram e a presença continua responsiva, sem flashes bruscos."}
  };
  class PresenceOrb{
    constructor(canvas){
      this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:true});
      this.state='idle';this.intensity=.85;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.hue=[...definitions.idle.hue];this.energy=.36;this.time=0;this.spin=0;
      this.last=0;this.lastDraw=0;this.frameId=0;this.visible=true;this.dirty=true;
      this.pointer={x:0,y:0};this.tilt={x:0,y:0};this.impulse=0;this.hover=0;this.hoverTarget=0;
      this.nodes=Array.from({length:116},(_,i)=>{const y=1-i/115*2,rr=Math.sqrt(1-y*y),a=i*2.39996323;return{x:Math.cos(a)*rr,y,z:Math.sin(a)*rr,phase:i*1.73};});
      this.edges=[];
      for(let i=0;i<this.nodes.length;i++)for(let j=i+1;j<this.nodes.length;j++){
        const a=this.nodes[i],b=this.nodes[j];if(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<.43)this.edges.push({a:i,b:j});
      }
      const sprite=document.createElement('canvas');sprite.width=sprite.height=64;
      const g=sprite.getContext('2d'),glow=g.createRadialGradient(32,32,0,32,32,32);
      glow.addColorStop(0,'#fff');glow.addColorStop(.07,'rgba(235,255,248,.95)');glow.addColorStop(.24,'rgba(145,255,211,.35)');glow.addColorStop(1,'rgba(80,250,198,0)');
      g.fillStyle=glow;g.fillRect(0,0,64,64);this.sprite=sprite;
      this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);
      this.intersectionObserver=new IntersectionObserver(([e])=>{this.visible=e.isIntersecting;this.schedule();});this.intersectionObserver.observe(canvas);
      document.addEventListener('visibilitychange',()=>this.schedule());
      canvas.setAttribute('role','button');canvas.tabIndex=0;
      canvas.title='Mova o cursor para orientar o núcleo. Clique ou pressione Enter para energizar.';
      canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();this.pointer.x=(e.clientX-r.left)/r.width-.5;this.pointer.y=(e.clientY-r.top)/r.height-.5;this.hoverTarget=1;});
      canvas.addEventListener('pointerleave',()=>{this.pointer={x:0,y:0};this.hoverTarget=0;});
      canvas.addEventListener('click',()=>this.energize());
      canvas.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.energize();}});
      this.resize();
    }
    energize(){this.impulse=1;this.dirty=true;this.canvas.dataset.pulse=String(Date.now());this.schedule();}
    resize(){
      const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
      this.width=rect.width;this.height=rect.height;const dpr=Math.min(devicePixelRatio||1,1.6);
      this.canvas.width=Math.round(rect.width*dpr);this.canvas.height=Math.round(rect.height*dpr);this.ctx.setTransform(dpr,0,0,dpr,0,0);
      this.draw();this.dirty=false;this.schedule();
    }
    setState(mode){if(!definitions[mode])return;this.state=mode;this.dirty=true;this.canvas.setAttribute('aria-label',`Núcleo holográfico da Órbita: ${definitions[mode].label}. Clique para energizar.`);this.schedule();}
    setReduced(reduced){this.reduced=reduced;this.dirty=true;this.schedule();}
    schedule(){cancelAnimationFrame(this.frameId);if(!this.visible||document.hidden){this.last=0;return;}this.frameId=requestAnimationFrame(t=>this.frame(t));}
    frame(now){
      if(!this.visible||document.hidden){this.last=0;return;}
      const dt=this.last?Math.min((now-this.last)/1000,.06):.016;this.last=now;
      if(!this.reduced){this.time+=dt;this.spin+=dt*definitions[this.state].speed;this.impulse=Math.max(0,this.impulse-dt*.54);}
      if(now-this.lastDraw>=(this.state==='idle'?1000/24:1000/30)||this.dirty){if(!this.reduced||this.dirty)this.draw();this.lastDraw=now;this.dirty=false;}
      if(!this.reduced)this.frameId=requestAnimationFrame(t=>this.frame(t));
    }
    draw(){
      if(!this.width||!this.height)return;
      const ctx=this.ctx,w=this.width,h=this.height,cfg=definitions[this.state],s=this.state;
      const t=this.reduced?2.3:this.time,spin=this.reduced?.4:this.spin,blend=this.reduced?1:.085;
      this.hue=this.hue.map((v,i)=>v+(cfg.hue[i]-v)*blend);this.energy+=(cfg.energy-this.energy)*blend;
      this.tilt.x+=(this.pointer.x-this.tilt.x)*.085;this.tilt.y+=(this.pointer.y-this.tilt.y)*.085;this.hover+=(this.hoverTarget-this.hover)*.08;
      const [rr,gg,bb]=this.hue.map(Math.round),dark=document.documentElement.dataset.theme==='dark';
      const color=(a,white=0)=>`rgba(${Math.round(rr+(255-rr)*white)},${Math.round(gg+(255-gg)*white)},${Math.round(bb+(255-bb)*white)},${a})`;
      const trace=a=>dark?color(a):`rgba(${Math.round(rr*.26)},${Math.round(gg*.46)},${Math.round(bb*.43)},${a})`;
      const amp=.4+this.intensity*.6,E=this.energy,impact=this.reduced?0:this.impulse;
      const voice=s==='speaking'?(Math.sin(t*8.8)*.045+Math.sin(t*15.5)*.028)*amp:0;
      const r=Math.min(h*.315,w*.245)*(1+Math.sin(t*1.65)*.014+voice+impact*.065);
      const cx=w/2+(this.reduced?0:this.tilt.x*10),cy=h*.48+(this.reduced?0:this.tilt.y*7);
      const yaw=spin*.35+(this.reduced?0:this.tilt.x*.62),pitch=-.24+Math.sin(t*.36)*.1+(this.reduced?0:this.tilt.y*.45);
      const project=(p,scale=1)=>{
        const x=p.x*Math.cos(yaw)+p.z*Math.sin(yaw),z=-p.x*Math.sin(yaw)+p.z*Math.cos(yaw);
        const y=p.y*Math.cos(pitch)-z*Math.sin(pitch),zz=p.y*Math.sin(pitch)+z*Math.cos(pitch),perspective=3.8/(3.8-zz*.22);
        return{x:cx+x*r*scale*perspective,y:cy+y*r*scale*perspective,z:zz};
      };
      const glow=(x,y,size,alpha=1)=>{ctx.globalAlpha=alpha;ctx.drawImage(this.sprite,x-size,y-size,size*2,size*2);ctx.globalAlpha=1;};
      const dot=(x,y,size,fill)=>{ctx.fillStyle=fill;ctx.beginPath();ctx.arc(x,y,size,0,TAU);ctx.fill();};
      ctx.clearRect(0,0,w,h);
      const aura=ctx.createRadialGradient(cx,cy,r*.38,cx,cy,r*1.9);
      aura.addColorStop(0,color(dark?.25:.14));aura.addColorStop(.6,color(.05));aura.addColorStop(1,color(0));ctx.fillStyle=aura;ctx.fillRect(0,0,w,h);
      // Giroscópios 3D divididos em trás/frente para oclusão real.
      const ringConfigs=[{rx:.37,rz:-.43,rad:1.47},{rx:1.04,rz:.69,rad:1.37},{rx:-.7,rz:1.6,rad:1.27}];
      const ringPoint=(angle,index)=>{
        const o=ringConfigs[index],tilt=o.rx+Math.sin(t*.3+index)*.18;
        const radius=o.rad+(s==='connecting'?Math.sin(t*2.2+index)*.12:0)+this.hover*.025;
        const x=Math.cos(angle)*radius,y=Math.sin(angle)*radius*Math.cos(tilt),z=Math.sin(angle)*radius*Math.sin(tilt);
        const turn=o.rz+spin*(index===1?-.19:.14);
        return project({x:x*Math.cos(turn)-y*Math.sin(turn),y:x*Math.sin(turn)+y*Math.cos(turn),z});
      };
      const rings=front=>{
        for(let k=0;k<3;k++){
          for(let layer=0;layer<2;layer++){
            ctx.beginPath();let pen=false;
            for(let i=0;i<=144;i++){
              const angle=i/144*TAU,p=ringPoint(angle,k),gap=((i+k*5+Math.floor(spin*9))%36)>29;
              if((p.z>=0)!==front||(s==='error'&&i%38>20)||(layer===1&&gap)){pen=false;continue;}
              const off=layer?1:1.012,x=cx+(p.x-cx)*off,y=cy+(p.y-cy)*off;
              if(pen)ctx.lineTo(x,y);else ctx.moveTo(x,y);pen=true;
            }
            ctx.strokeStyle=layer?trace(front?.66:.23):trace(.12);ctx.lineWidth=layer?(k===0?1.15:.7):.5;ctx.stroke();
          }
          const a=spin*(k===1?-1.5:1.3)+k*2.2,p=ringPoint(a,k);
          if((p.z>=0)===front){glow(p.x,p.y,8,.5);dot(p.x,p.y,2.1,dark?color(1,.7):trace(.9));}
        }
      };
      rings(false);
      // Casca escura torna circuitos emissivos legíveis nos dois temas.
      ctx.save();ctx.beginPath();ctx.arc(cx,cy,r*1.035,0,TAU);ctx.clip();
      const shell=ctx.createRadialGradient(cx-r*.2,cy-r*.2,r*.03,cx,cy,r*1.07);
      shell.addColorStop(0,'rgba(9,32,32,.97)');shell.addColorStop(.58,'rgba(8,27,30,.96)');shell.addColorStop(.84,'rgba(12,44,43,.94)');shell.addColorStop(1,'rgba(43,91,73,.13)');
      ctx.fillStyle=shell;ctx.fillRect(cx-r*1.1,cy-r*1.1,r*2.2,r*2.2);
      const points=this.nodes.map((n,i)=>{
        const fluctuation=1+Math.sin(t*(s==='thinking'?3.1:1.4)+n.phase)*.022*E*amp;
        let p=project(n,fluctuation);if(s==='error'&&i%7===0)p.x+=Math.sin(Math.floor(t*2)+i)*r*.045;return p;
      });
      ctx.globalCompositeOperation='screen';
      for(let bucket=0;bucket<6;bucket++){
        ctx.beginPath();
        for(const edge of this.edges){
          const a=points[edge.a],b=points[edge.b],depth=(a.z+b.z+2)/4;
          if(Math.min(5,Math.floor(depth*6))!==bucket||(s==='error'&&edge.a%9<2))continue;
          ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
        }
        ctx.strokeStyle=color(.05+bucket*.038+E*.035);ctx.lineWidth=.35+bucket*.08;ctx.stroke();
      }
      for(let latitude=-2;latitude<=2;latitude++){
        const ly=latitude*.31,rad=Math.sqrt(1-ly*ly);ctx.beginPath();let pen=false;
        for(let i=0;i<=80;i++){
          const a=i/80*TAU,p=project({x:Math.cos(a)*rad,y:ly,z:Math.sin(a)*rad});
          if(p.z<0||i%27>23){pen=false;continue;}if(pen)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);pen=true;
        }
        ctx.strokeStyle=color(.15,.24);ctx.lineWidth=.5;ctx.stroke();
      }
      const sweep=(t*1.65)%TAU;
      for(let i=0;i<points.length;i++){
        const p=points[i],depth=(p.z+1)/2;let brightness=.25+depth*.6;
        if(s==='searching'){
          const delta=Math.abs(Math.atan2(Math.sin(Math.atan2(p.y-cy,p.x-cx)-sweep),Math.cos(Math.atan2(p.y-cy,p.x-cx)-sweep)));
          if(delta<.4)brightness+=1-delta/.4;
        }
        const neuralFire=Math.max(0,Math.sin(t*(s==='thinking'?4:1.6)-i*.8)-.78);brightness+=neuralFire*(s==='thinking'?3:1.2);
        const size=(i%9===0?1.6:.8)*(.6+depth*.6);
        if(i%6===0||brightness>.9)glow(p.x,p.y,size*6,Math.min(.8,brightness*.55));dot(p.x,p.y,size,color(Math.min(1,brightness),.35));
      }
      const packetCount=s==='thinking'?24:s==='executing'?28:s==='connecting'?15:7;
      for(let i=0;i<packetCount;i++){
        const edge=this.edges[(i*23+Math.floor(i/4)*17)%this.edges.length],a=points[edge.a],b=points[edge.b];
        const progress=(t*(.35+(i%5)*.14)*(s==='thinking'||s==='executing'?2.6:1)+i*.173)%1;
        const x=a.x+(b.x-a.x)*progress,y=a.y+(b.y-a.y)*progress;glow(x,y,5,.7);dot(x,y,1.05,color(.95,.85));
      }
      if(s==='searching'){
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r*1.03,sweep-.38,sweep);ctx.closePath();ctx.fillStyle=color(.12);ctx.fill();
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(sweep)*r,cy+Math.sin(sweep)*r);ctx.strokeStyle=color(.8,.55);ctx.lineWidth=1.3;ctx.stroke();
      }
      ctx.restore();
      // Reator: fonte energética central e anéis segmentados de contenção.
      const reactorBeat=1+Math.sin(t*2.3)*.08+(s==='speaking'?(Math.sin(t*8.8)*.18+Math.sin(t*15.5)*.1):0)+impact*.7;
      glow(cx,cy,r*(.7+E*.17)*reactorBeat,.5+E*.25);
      const inner=ctx.createRadialGradient(cx,cy,0,cx,cy,r*.45*reactorBeat);
      inner.addColorStop(0,'rgba(248,255,255,.98)');inner.addColorStop(.09,'rgba(233,255,250,.96)');inner.addColorStop(.23,color(.85,.7));inner.addColorStop(.43,color(.24));inner.addColorStop(1,color(0));
      ctx.fillStyle=inner;ctx.beginPath();ctx.arc(cx,cy,r*.45*reactorBeat,0,TAU);ctx.fill();
      for(let k=0;k<3;k++){
        const radius=r*(.14+k*.08)*(1+voice*1.4),rotation=spin*(k%2?-2.5:2)+k;
        for(let segment=0;segment<3;segment++){const a=rotation+segment*TAU/3;ctx.beginPath();ctx.arc(cx,cy,radius,a,a+1.44);ctx.strokeStyle=color(.8-k*.15,.5);ctx.lineWidth=k===0?2:1;ctx.stroke();}
      }
      ctx.beginPath();ctx.arc(cx,cy,r*1.025,0,TAU);ctx.strokeStyle=color(.28,.2);ctx.lineWidth=.8;ctx.stroke();rings(true);
      const perimeter=r*1.17;
      for(let i=0;i<64;i++){
        const a=i/64*TAU-spin*.08,major=i%8===0,rad=perimeter+(s==='executing'?Math.sin(t*3-i*.18)*2:0);
        ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad);ctx.lineTo(cx+Math.cos(a)*(rad+(major?5:2)),cy+Math.sin(a)*(rad+(major?5:2)));
        ctx.strokeStyle=trace(major?.47:.19);ctx.lineWidth=major?1:.65;ctx.stroke();
      }
      if(s==='listening'||s==='speaking'){
        const bars=72,base=r*(s==='listening'?1.23:1.18);
        for(let i=0;i<bars;i++){
          const a=i/bars*TAU,signal=(Math.sin(i*.43+t*7.5)*.45+Math.sin(i*.79-t*4.1)*.3+Math.sin(t*2.7)*.2),length=(3+Math.abs(signal)*(s==='speaking'?26:18))*amp;
          ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*base,cy+Math.sin(a)*base);ctx.lineTo(cx+Math.cos(a)*(base+length),cy+Math.sin(a)*(base+length));ctx.strokeStyle=trace(.3+Math.abs(signal)*.4);ctx.lineWidth=1.5;ctx.stroke();
        }
        if(s==='speaking'){ctx.beginPath();for(let i=0;i<=100;i++){const x=(i/100-.5)*r*1.68,y=cy+Math.sin(i*.26-t*9)*Math.sin(i/100*Math.PI)*r*.13*amp;i?ctx.lineTo(cx+x,y):ctx.moveTo(cx+x,y);}ctx.strokeStyle=color(.9,.65);ctx.lineWidth=1.6;ctx.stroke();}
      }
      if(s==='connecting'||s==='executing'){
        const count=s==='executing'?4:6;
        for(let i=0;i<count;i++){
          const a=i/count*TAU+spin*.15,rad=r*(1.6+Math.sin(t*1.7+i)*.08),x=cx+Math.cos(a)*rad,y=cy+Math.sin(a)*rad*.7;
          ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.strokeStyle=trace(.24);ctx.lineWidth=.7;ctx.stroke();ctx.strokeStyle=trace(.65);ctx.strokeRect(x-3,y-3,6,6);
          for(let j=0;j<3;j++){const p=(t*(s==='executing'?.8:.45)+j/3+i*.12)%1,px=cx+(x-cx)*p,py=cy+(y-cy)*p;glow(px,py,6,.6);dot(px,py,1.4,trace(.8));}
        }
        if(s==='executing')for(let i=0;i<4;i++){const a=i*TAU/4+spin*.4;ctx.beginPath();ctx.arc(cx,cy,r*1.32,a,a+.24+(Math.sin(t*2+i)+1)*.3);ctx.strokeStyle=trace(.7);ctx.lineWidth=3;ctx.stroke();}
      }
      if(s==='attention'){
        for(let k=0;k<2;k++){ctx.beginPath();for(let i=0;i<=6;i++){const a=i/6*TAU-Math.PI/6,rad=r*(1.27+k*.09);i?ctx.lineTo(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad):ctx.moveTo(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad);}ctx.strokeStyle=trace(k?.2:.65);ctx.lineWidth=k?.6:1.2;ctx.stroke();}
        ctx.fillStyle=color(.9,.6);ctx.fillRect(cx-4,cy-7,2,14);ctx.fillRect(cx+2,cy-7,2,14);
      }
      if(s==='error'){
        for(let i=0;i<5;i++){const a=i*1.28+.4,offset=Math.sin(Math.floor(t*2)+i)*3;ctx.beginPath();ctx.arc(cx+offset,cy,r*(1.17+i%2*.04),a,a+.46);ctx.strokeStyle=trace(.65);ctx.lineWidth=1.7;ctx.stroke();}
        ctx.beginPath();ctx.moveTo(cx,cy-7);ctx.lineTo(cx,cy+2);ctx.strokeStyle=color(.95,.6);ctx.lineWidth=2;ctx.stroke();dot(cx,cy+6,1.1,color(1,.7));
      }
      if(s==='success'){
        ctx.beginPath();ctx.moveTo(cx-8,cy);ctx.lineTo(cx-2,cy+6);ctx.lineTo(cx+9,cy-7);ctx.strokeStyle='#fff';ctx.lineWidth=2.2;ctx.stroke();
        for(let i=0;i<22;i++){const a=i*2.4,p=(t*.35+i*.073)%1,rad=r*(.9+p*.85);dot(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad*.75,1.1,trace((1-p)*.55));}
      }
      if(s==='listening'||s==='success'||impact>0){
        for(let i=0;i<2;i++){let phase=(t*.6+i*.5)%1;if(s==='listening')phase=1-phase;if(impact>0)phase=(1-impact+i*.22)%1;ctx.beginPath();ctx.arc(cx,cy,r*(.95+phase*.68),0,TAU);ctx.strokeStyle=trace((1-phase)*(.22+impact*.4));ctx.lineWidth=impact>0?1.5:.8;ctx.stroke();}
      }
      if(w>470){
        const left=cx-r*1.72,right=cx+r*1.72;ctx.font='7px Consolas, monospace';ctx.fillStyle=trace(.6);ctx.textAlign='right';ctx.fillText('NEURAL / '+String(this.nodes.length).padStart(3,'0'),left,cy-r*.65);
        ctx.textAlign='left';ctx.fillText(s==='executing'?'EXEC / DEMO':s==='listening'?'INPUT / DEMO':'CORE / ONLINE',right,cy+r*.69);ctx.strokeStyle=trace(.25);ctx.lineWidth=.6;
        ctx.beginPath();ctx.moveTo(left-12,cy-r*.58);ctx.lineTo(left+18,cy-r*.58);ctx.lineTo(cx-r*.82,cy-r*.38);ctx.stroke();ctx.beginPath();ctx.moveTo(right+39,cy+r*.56);ctx.lineTo(right-9,cy+r*.56);ctx.lineTo(cx+r*.83,cy+r*.38);ctx.stroke();
      }
      if(this.hover>.03&&!this.reduced){
        const x=cx+this.tilt.x*w*.45,y=cy+this.tilt.y*h*.45;ctx.strokeStyle=trace(this.hover*.4);ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(x-7,y);ctx.lineTo(x-3,y);ctx.moveTo(x+3,y);ctx.lineTo(x+7,y);ctx.moveTo(x,y-7);ctx.lineTo(x,y-3);ctx.moveTo(x,y+3);ctx.lineTo(x,y+7);ctx.stroke();
      }
    }
  }
  window.ORBITA_STATES=definitions;window.PresenceOrb=PresenceOrb;
})();
