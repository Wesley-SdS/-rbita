/// <reference types="chrome" />

/**
 * A BORDA E O BOTÃO PARAR na aba (PRD B3, F6), mais o "o dono mexeu".
 *
 * Roda em toda página e em todo quadro, desde o COMEÇO do documento
 * (`document_start`), e só acorda nas abas do grupo da Órbita com sessão ativa.
 *
 * "O dono mexeu, a Órbita para": clique ou tecla CONFIÁVEL (`isTrusted`) na
 * aba pausa a sessão. O clique da Órbita, que chega por CDP, também é
 * confiável; por isso a página é marcada antes de cada ação dela
 * (`__orbita.agindoAte`, no mesmo mundo isolado em que este script roda) e só
 * o evento fora dessa janela conta como do dono. Num iframe a marca não existe:
 * quem descarta o clique da própria Órbita ali é o service worker, que sabe
 * quando ele mesmo mandou entrada.
 *
 * Por que assim (I-11 da auditoria): com `document_idle` a página registrava
 * ANTES um ouvinte de captura no `window` com `stopImmediatePropagation`, e o
 * nosso nunca via o clique; com `all_frames: false` um clique num iframe não
 * pausava; e a página removia ou cobria a `<orbita-borda>`. Agora o ouvinte é
 * o PRIMEIRO do `window` (o content script de `document_start` roda antes de
 * qualquer script da página), a borda mora na camada de cima do navegador
 * (popover: z-index nenhum passa por cima) e um observador a põe de volta se
 * a página tirar, esconder ou mexer no estilo dela.
 */

interface EstadoNaPagina {
  agindoAte?: number;
}

const NO_TOPO = window.top === window;
let host: HTMLElement | null = null;
let ligada = false;
let atual = { objetivo: "", cor: "purple" };

// ── o dono mexeu: registrado ANTES de qualquer outra coisa ──────────────────
function doDono(ev: Event): void {
  if (!ligada || !ev.isTrusted) return;
  // o próprio botão Parar não é "mexer"
  if (host && ev.composedPath().includes(host)) return;
  const est = (globalThis as unknown as { __orbita?: EstadoNaPagina }).__orbita;
  if (est?.agindoAte && Date.now() < est.agindoAte) return;
  ligada = false;
  void chrome.runtime.sendMessage({ tipo: "orbita:dono-mexeu" }).catch(() => undefined);
}
for (const tipo of ["pointerdown", "mousedown", "keydown"]) window.addEventListener(tipo, doDono, { capture: true, passive: true });

// ── a borda (só no documento de cima; num iframe, só o "o dono mexeu") ─────
const COR: Record<string, string> = { purple: "#a142f4", blue: "#1a73e8", cyan: "#12b5cb", green: "#1e8e3e", yellow: "#f9ab00", orange: "#fa903e", red: "#d93025", pink: "#e52592", grey: "#5f6368" };

/**
 * Estilo do host com `!important` inline: folha de estilo da página nenhuma o
 * esconde. Escrito de uma vez (o atributo inteiro) e só quando a página mexeu:
 * reescrever propriedade a propriedade gerava mudança no atributo a cada vez,
 * e o próprio observador reagia a ela num laço que travava a página.
 */
const ESTILO_DO_HOST = [
  "all: initial", "display: block", "position: fixed", "inset: 0", "width: 100vw", "height: 100vh", "margin: 0", "padding: 0", "border: 0", "background: transparent",
  "overflow: visible", "pointer-events: none", "z-index: 2147483647", "opacity: 1", "visibility: visible", "transform: none", "filter: none", "clip-path: none",
]
  .map((d) => `${d} !important`)
  .join("; ");
function estiloDoHost(h: HTMLElement): void {
  if (h.getAttribute("style") !== ESTILO_DO_HOST) h.setAttribute("style", ESTILO_DO_HOST);
}

/** Popover no topo da camada de cima: acima de qualquer z-index; reabre se outra coisa abrir por cima. */
function trazerParaCima(h: HTMLElement): void {
  try {
    if (h.matches(":popover-open")) h.hidePopover();
    h.showPopover();
  } catch {
    /* Chrome sem popover (antes do 114): fica o z-index máximo */
  }
}

function desenhar(): void {
  if (!NO_TOPO) return;
  if (host) host.remove();
  const h = document.createElement("orbita-borda");
  host = h;
  h.setAttribute("popover", "manual");
  estiloDoHost(h);
  const raiz = h.attachShadow({ mode: "closed" });
  const corCss = COR[atual.cor] ?? COR.purple!;
  raiz.innerHTML = `
    <style>
      .borda { position: fixed; inset: 0; border: 4px solid ${corCss}; box-sizing: border-box; pointer-events: none; }
      .barra { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: center;
        background: #1b1b1f; color: #fff; font: 600 13px/1.2 system-ui, sans-serif; padding: 6px 8px 6px 12px; border-radius: 999px;
        box-shadow: 0 2px 10px rgba(0,0,0,.35); pointer-events: auto; max-width: 70vw; }
      .texto { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      button { all: unset; cursor: pointer; background: #d93025; color: #fff; padding: 5px 12px; border-radius: 999px; font: 700 13px system-ui, sans-serif; }
      button:focus-visible { outline: 2px solid #fff; }
    </style>
    <div class="borda"></div>
    <div class="barra" role="status"><span class="texto"></span><button type="button">Parar</button></div>`;
  (raiz.querySelector(".texto") as HTMLElement).textContent = `Órbita no controle: ${atual.objetivo}`;
  raiz.querySelector("button")!.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void chrome.runtime.sendMessage({ tipo: "orbita:parar" });
    apagar();
  });
  // a página fechou o popover (hidePopover): abre de novo
  h.addEventListener("toggle", (ev) => {
    if (ligada && host === h && (ev as ToggleEvent).newState === "closed") queueMicrotask(() => trazerParaCima(h));
  });
  document.documentElement.appendChild(h);
  trazerParaCima(h);
}

function apagar(): void {
  ligada = false;
  remocoes = [];
  const h = host;
  host = null;
  h?.remove();
}

function aplicar(e: { ligar: boolean; objetivo: string; cor: string }): void {
  if (e.ligar) {
    ligada = true;
    atual = { objetivo: e.objetivo, cor: e.cor };
    desenhar();
  } else apagar();
}

/**
 * A página que TIRA a borda de novo a cada vez que ela volta está brigando
 * com a Órbita. Pôr de volta sem parar viraria um laço (o observador dela tira,
 * o nosso põe) que trava a página; e sem a borda o dono não vê que a Órbita
 * está no controle. Então: depois de algumas voltas em pouco tempo, a Órbita
 * desiste da borda e PAUSA a sessão, avisando por quê.
 */
const REMOCOES_PARA_DESISTIR = 3;
const JANELA_DAS_REMOCOES_MS = 3000;
let remocoes: number[] = [];
function bordaSabotada(): boolean {
  const agora = Date.now();
  remocoes = [...remocoes.filter((t) => agora - t < JANELA_DAS_REMOCOES_MS), agora];
  if (remocoes.length < REMOCOES_PARA_DESISTIR) return false;
  ligada = false;
  host = null;
  remocoes = [];
  void chrome.runtime.sendMessage({ tipo: "orbita:borda-escondida" }).catch(() => undefined);
  return true;
}

if (NO_TOPO) {
  // a página tirou a borda, mexeu no estilo ou no atributo dela: põe de volta como era (até a página mostrar que briga)
  const vigia = new MutationObserver(() => {
    if (!ligada) return;
    if (!host || !host.isConnected) {
      if (bordaSabotada()) return;
      return desenhar();
    }
    if (host.getAttribute("popover") !== "manual") host.setAttribute("popover", "manual");
    estiloDoHost(host);
  });
  const vigiar = () => {
    vigia.observe(document.documentElement, { childList: true });
    if (host) vigia.observe(host, { attributes: true, attributeFilter: ["style", "popover", "hidden", "class"] });
  };
  vigiar();
  // outra coisa na camada de cima (um <dialog> modal, outro popover) ficaria por cima: a borda volta ao topo
  setInterval(() => {
    if (!ligada) return;
    if (!host || !host.isConnected) {
      if (bordaSabotada()) return;
      return desenhar();
    }
    vigiar();
    const outros = [...document.querySelectorAll(":popover-open, dialog:modal")].some((x) => x !== host);
    if (outros || !host.matches(":popover-open")) trazerParaCima(host);
  }, 1000);
}

chrome.runtime.onMessage.addListener((m: { tipo?: string; ligar?: boolean; objetivo?: string; cor?: string }) => {
  if (m.tipo === "orbita:borda") aplicar({ ligar: !!m.ligar, objetivo: m.objetivo ?? "", cor: m.cor ?? "purple" });
});

// a página recarregou ou navegou: pergunta se ainda está no escopo
const perguntar = () =>
  void chrome.runtime
    .sendMessage({ tipo: "orbita:estado-da-aba" })
    .then((e: { ligar: boolean; objetivo: string; cor: string } | undefined) => e && aplicar(e))
    .catch(() => undefined);
// em `document_start` o documento ainda está vazio, e a aba que a Órbita acabou de abrir pode nem estar no grupo
// ainda: pergunta agora e de novo quando a página termina de carregar
if (document.documentElement) perguntar();
else document.addEventListener("readystatechange", perguntar, { once: true });
window.addEventListener("load", perguntar, { once: true });
