/* Fontes reais; descoberta e resposta roteirizadas para avaliar somente o front. */
(() => {
  'use strict';
  const sources = [
    {name:'MDN Web Docs',domain:'developer.mozilla.org',mark:'M',type:'DOCUMENTAÇÃO',title:'Gráficos 3D no navegador',excerpt:'Como o WebGL desenha gráficos interativos no canvas, com aceleração por hardware.',url:'https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API',color:'mint'},
    {name:'Three.js',domain:'threejs.org',mark:'△',type:'REFERÊNCIA TÉCNICA',title:'Geometrias, luzes e materiais',excerpt:'Uma referência para explorar os componentes de uma cena tridimensional na web.',url:'https://threejs.org/docs/',color:'violet'},
    {name:'Khronos Group',domain:'khronos.org',mark:'K',type:'PADRÃO ABERTO',title:'O padrão por trás do 3D na web',excerpt:'Visão oficial da API WebGL e de seu papel nos gráficos 3D para navegadores.',url:'https://www.khronos.org/webgl/',color:'peach'}
  ];
  let found=[],timers=[],active=false,completed=false,started=0;
  const original=document.querySelector('.day-panel');
  const panel=document.createElement('aside');panel.id='research-panel';panel.className='research-panel';panel.hidden=true;
  original.insertAdjacentElement('afterend',panel);
  const trigger=document.createElement('button');trigger.type='button';trigger.className='research-trigger';trigger.dataset.action='research-demo';
  trigger.innerHTML='<span class="research-trigger-icon" aria-hidden="true">⌕</span> Pesquisar com fontes <span aria-hidden="true">↗</span>';
  document.querySelector('.presence-foot').insertAdjacentElement('beforebegin',trigger);
  const status=()=>completed?'Pesquisa concluída':active?'Consultando referências…':'Pesquisa interrompida';
  function card(source,index){return `<a class="source-card" href="${source.url}" target="_blank" rel="noopener noreferrer" style="--source-order:${index}"><span class="source-card-top"><span class="source-mark ${source.color}" aria-hidden="true">${source.mark}</span><span><strong>${source.name}</strong><small>${source.domain}</small></span><span class="source-arrow" aria-hidden="true">↗</span></span><span class="source-type">${source.type} <span>FONTE ${String(index+1).padStart(2,'0')}</span></span><h3>${source.title}</h3><p>${source.excerpt}</p><span class="source-card-bottom"><span class="source-check" aria-hidden="true">✓</span> Abrir fonte original <span>↗</span></span></a>`;}
  function cards(){return found.map(card).join('');}
  function chatHTML(){return `<section class="chat-research"><div class="research-status"><span class="research-beacon ${active?'is-scanning':''}"></span><strong>${status()}</strong><span>${found.length}/3 fontes</span></div><p class="research-demo-note">Exemplo: interfaces 3D na web. Fontes reais; descoberta simulada.</p><div class="chat-source-grid">${cards()||'<div class="source-empty">Preparando a primeira referência…</div>'}</div></section>`;}
  function render(){panel.innerHTML=`<header class="research-heading"><div><span class="eyebrow">INVESTIGAÇÃO EM CURSO</span><h2>Conhecimento com origem.</h2></div><button type="button" class="research-close" data-research-close aria-label="Fechar fontes de pesquisa">×</button></header><div class="research-query"><span aria-hidden="true">⌕</span><div><small>EXEMPLO DE PESQUISA</small><strong>Interfaces 3D no navegador</strong></div></div><div class="research-status" role="status"><span class="research-beacon ${active?'is-scanning':''}"></span><strong>${status()}</strong><span>${found.length}/3</span></div><div class="research-track"><i style="width:${found.length/3*100}%"></i></div><div class="source-list">${cards()}${active&&found.length<3?'<div class="source-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>':''}</div><div class="research-disclaimer"><span>DEMONSTRAÇÃO DO FRONT</span>Os links são reais. A descoberta é roteirizada, sem busca conectada.</div>`;document.dispatchEvent(new CustomEvent('orbita:research-update'));}
  function stop(){timers.forEach(clearTimeout);timers=[];active=false;render();}
  function start(){timers.forEach(clearTimeout);timers=[];found=[];active=true;completed=false;started++;const run=started;panel.hidden=false;original.hidden=true;render();
    sources.forEach((source,index)=>timers.push(setTimeout(()=>{if(run!==started||!active)return;found.push(source);if(found.length===sources.length){active=false;completed=true;}render();if(completed)document.dispatchEvent(new CustomEvent('orbita:research-complete'));},800+index*1050)));
  }
  function close(){started++;stop();panel.hidden=true;original.hidden=false;document.dispatchEvent(new CustomEvent('orbita:research-close'));}
  document.addEventListener('click',e=>{if(e.target.closest('[data-research-close]'))close();if(e.target.closest('[data-action="research-demo"]')){document.dispatchEvent(new CustomEvent('orbita:research-start'));start();}});
  new MutationObserver(()=>{if(document.body.dataset.orbState==='searching'&&!active)start();}).observe(document.body,{attributes:true,attributeFilter:['data-orb-state']});
  window.orbitaResearch={start,stop,close,chatHTML,get sources(){return found;},get active(){return active;},get complete(){return completed;}};
  addEventListener('pagehide',()=>timers.forEach(clearTimeout));
})();
