/// <reference types="chrome" />
import { orbitaNaPagina, type PedidoNaPagina, type RespostaNaPagina } from "../../../packages/core/src/navegador/pagina";
import { capturarAba, executarAgir, RecusaDasMaos, type MaosDaAba } from "../../../packages/core/src/navegador/executor";
import { urlNaLista, urlRecusadaPelasMaos } from "../../../packages/core/src/navegador/categorias";
import type { AbaVista, EnvelopeDaExtensao, MensagemParaExtensao, Ordem, OrigemDaOrdem, RegraDeSitesDaExtensao, ResultadoDaOrdem } from "../../../packages/core/src/navegador/protocolo";

/**
 * O SERVICE WORKER da extensão (PRD B1 a B3, B7, F6 do lado do Chrome).
 *
 * Executa, não decide: quem decide risco, sessão, crítico e fila é o core. Mas
 * REPETE as travas duras do lado de cá, para um bug do api não bastar:
 *   - ordem de ROTINA ou REGRA é recusada (no Chrome do dono só o dono manda; rotina vai ao perfil dedicado);
 *   - site bloqueado (categorias e lista do dono, e a própria Órbita sempre) não é lido, nem o título;
 *   - agir só com um envelope que VALE agora (ativo, no prazo, abaixo do teto de passos, contados aqui também),
 *     só nas abas do grupo "Órbita: …" (quem põe uma aba do dono no grupo é o dono, arrastando) e só em site do
 *     envelope (ou liberado para agir, ou aprovado na fila);
 *   - senha, cartão e código: a página recusa digitar e mascara antes de qualquer byte sair, em todos os quadros;
 *   - depois do Parar (botão na aba, faixa do depurador cancelada), nada age até chegar um envelope NOVO.
 *
 * O Parar e o "o dono mexeu" nascem aqui e não podem se perder com o canal
 * caído (o `tsx watch` reinicia o api a cada arquivo salvo): ficam guardados em
 * `chrome.storage.session` e são reenviados logo depois de autenticar, antes de
 * qualquer envelope valer de novo, até o core confirmar (`evento_recebido`).
 *
 * O service worker MV3 morre com ~30 s parado: o estado mora em
 * `chrome.storage` (o token em `local`, a sessão em `session`), nunca só em
 * variável. O canal vivo (WebSocket ou native messaging) o mantém acordado, e
 * um alarme a cada minuto reconecta se ele tiver morrido mesmo assim.
 */

const VERSAO = chrome.runtime.getManifest().version;
const HOST_NATIVO = "com.orbita.ponte";
const URL_PADRAO = "ws://127.0.0.1:3010/api/navegador/canal";
const NOME_DO_CHROME = `Chrome ${navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? "?"}`;
/** recusas seguidas do token antes de parar de tentar (token revogado com a extensão fora do ar) */
const RECUSAS_PARA_DESISTIR = 3;
/** a ponte corta mensagem grande em pedaços: teto do inteiro e do tempo para juntar */
const MAX_JUNTADO = 16 * 1024 * 1024;
const MAX_PEDACOS = 64;
const PRAZO_DO_PEDACO_MS = 30_000;

interface EstadoLocal {
  token?: string;
  apiUrl?: string;
}
interface EventoPendente {
  id: string;
  tipo: "parar" | "dono_mexeu" | "borda_escondida";
  sessaoId: string;
  aba?: number;
  detalhe?: string;
  em: number;
}
interface EstadoDaSessao {
  envelope: EnvelopeDaExtensao | null;
  sites: RegraDeSitesDaExtensao;
  corDoGrupo: string;
  agindoMs: number;
  keepaliveSeg: number;
  grupoId: number | null;
  /** o dono apertou Parar (ou mexeu): nada age até um envelope novo */
  parado: boolean;
  /** a sessão que foi parada ou acabou aqui: um envelope DELA que chegue depois (reconexão) não a revive */
  sessaoEncerrada: string | null;
  /** ações feitas nesta sessão, contadas aqui (o espelho traz os passos de quando chegou) */
  passosLocais: number;
  /** Parar e "o dono mexeu" que o core ainda não confirmou */
  pendentes: EventoPendente[];
  depurando: number[];
  via: "nativo" | "websocket" | null;
  conectado: boolean;
  ultimoErro: string | null;
  nativoFalhouEm: number;
  /** recusas seguidas do token: passou do limite, a extensão para de tentar e pede para parear de novo */
  recusasDoToken: number;
}

// O estado da sessão (envelope, sites liberados) e o TOKEN são só das páginas da PRÓPRIA extensão: o content
// script roda dentro de sites de terceiros e não lê nem grava aqui. O `session` já é assim por padrão; o
// `local` (onde mora o token) não é, e por isso o pedido também vale para ele quando o Chrome deixa (O7 da revisão).
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
void (async () => {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    // Chrome sem suporte para o `local`: o content script desta extensão nunca lê o token (é código nosso),
    // e a página não alcança o mundo isolado. Fica registrado para quem medir.
    console.info("[orbita] storage.local sem setAccessLevel neste Chrome");
  }
})();

/** Pedidos que mudam o pareamento ou o endereço, ou leem o estado: só de uma página da extensão (popup, painel), nunca do content script. */
const SO_DA_EXTENSAO = new Set(["orbita:parear", "orbita:endereco", "orbita:esquecer", "orbita:status"]);

const SITES_VAZIOS: RegraDeSitesDaExtensao = { bloqueados: [], liberados: [], escrita: [], padraoBloqueado: false };
const PADRAO: EstadoDaSessao = {
  envelope: null, sites: SITES_VAZIOS, corDoGrupo: "purple", agindoMs: 800, keepaliveSeg: 20, grupoId: null, parado: false, sessaoEncerrada: null, passosLocais: 0, pendentes: [],
  depurando: [], via: null, conectado: false, ultimoErro: null, nativoFalhouEm: 0, recusasDoToken: 0,
};

async function ler(): Promise<EstadoDaSessao> {
  const s = (await chrome.storage.session.get("estado")) as { estado?: Partial<EstadoDaSessao> };
  return { ...PADRAO, ...(s.estado ?? {}) };
}

/**
 * As escritas do estado passam UMA de cada vez, e cada uma relê o que está
 * gravado antes de mesclar: duas escritas em paralelo liam o mesmo estado velho
 * e a segunda apagava a primeira (o "parado" de um Parar sumia assim).
 */
let filaDeGravacao: Promise<unknown> = Promise.resolve();
function mudar(fn: (e: EstadoDaSessao) => Partial<EstadoDaSessao>): Promise<EstadoDaSessao> {
  const p = filaDeGravacao.then(async () => {
    const atual = await ler();
    const e = { ...atual, ...fn(atual) };
    await chrome.storage.session.set({ estado: e });
    return e;
  });
  filaDeGravacao = p.catch(() => undefined);
  return p;
}
function gravar(p: Partial<EstadoDaSessao>): Promise<EstadoDaSessao> {
  return mudar(() => p);
}
async function local(): Promise<EstadoLocal> {
  return (await chrome.storage.local.get(["token", "apiUrl"])) as EstadoLocal;
}

// ── o canal: native messaging primeiro, WebSocket de reserva ────────────────
interface Canal {
  enviar(m: unknown): void;
  fechar(): void;
}
let canal: Canal | null = null;
/** o canal já autenticou (chegou `bem_vindo` ou `pareado`): só então os pendentes saem */
let autenticado = false;
let conectando = false;
let tentativas = 0;
let pareandoCom: string | null = null;
let relogioPing: ReturnType<typeof setInterval> | null = null;
/** até quando a PRÓPRIA Órbita está mandando entrada por CDP (para o clique num iframe, que não tem a marca da página) */
let agindoAteSw = 0;
const pedacos = new Map<string, { partes: string[]; n: number; bytes: number; inicio: number }>();

/**
 * Mudança de ESTADO (envelope, fim, parar, bem-vindo) roda em fila, na ordem em que chegou: abrir um envelope
 * novo manda "fim" do velho e "envelope" do novo juntos, e processados em paralelo o fim apagava o envelope
 * novo (visto no teste de ponta a ponta). Ordem espera o estado pendente, mas não trava a fila.
 */
let filaDeEstado: Promise<void> = Promise.resolve();
function ao(m: unknown): void {
  const falhou = (e: unknown) => console.warn("[orbita] mensagem falhou", e);
  if ((m as { t?: string })?.t === "ordem") {
    void filaDeEstado.then(() => receber(m)).catch(falhou);
    return;
  }
  filaDeEstado = filaDeEstado.then(() => receber(m)).catch(falhou);
}

/**
 * A ponte corta mensagem grande (limite de 1 MB do host para o Chrome): junta
 * aqui, com teto de tamanho, de pedaços e de tempo. Sem teto, um pedaço que
 * nunca completava ficava guardado para sempre.
 */
function juntarPedaco(m: { id: string; i: number; n: number; dados: string }): unknown | null {
  const agora = Date.now();
  for (const [id, p] of pedacos) if (agora - p.inicio > PRAZO_DO_PEDACO_MS) pedacos.delete(id);
  if (!Number.isInteger(m.n) || m.n < 1 || m.n > MAX_PEDACOS || !Number.isInteger(m.i) || m.i < 0 || m.i >= m.n || typeof m.dados !== "string") return null;
  const atual = pedacos.get(m.id) ?? { partes: new Array<string>(m.n), n: m.n, bytes: 0, inicio: agora };
  if (atual.n !== m.n || atual.partes[m.i] !== undefined) {
    pedacos.delete(m.id);
    return null;
  }
  atual.partes[m.i] = m.dados;
  atual.bytes += m.dados.length;
  if (atual.bytes > MAX_JUNTADO) {
    pedacos.delete(m.id);
    console.warn("[orbita] mensagem da ponte grande demais: descartada");
    return null;
  }
  pedacos.set(m.id, atual);
  if (atual.partes.filter((x) => x !== undefined).length < atual.n) return null;
  pedacos.delete(m.id);
  try {
    return JSON.parse(atual.partes.join(""));
  } catch {
    return null;
  }
}

function abrirNativo(primeira: unknown): Promise<Canal | null> {
  return new Promise((resolve) => {
    let porta: chrome.runtime.Port;
    try {
      porta = chrome.runtime.connectNative(HOST_NATIVO);
    } catch {
      return resolve(null);
    }
    let vivo = false;
    const c: Canal = {
      // a porta desconectada LANÇA no postMessage: o canal cai, e o evento fica nos pendentes
      enviar: (m) => {
        try {
          porta.postMessage(m);
        } catch {
          void caiu("a ponte fechou");
        }
      },
      fechar: () => porta.disconnect(),
    };
    porta.onMessage.addListener((m: { t?: string; id?: string; i?: number; n?: number; dados?: string }) => {
      if (!vivo) {
        vivo = true;
        resolve(c);
      }
      if (m?.t === "pedaco" && typeof m.id === "string") {
        const inteiro = juntarPedaco(m as { id: string; i: number; n: number; dados: string });
        if (inteiro) ao(inteiro);
        return;
      }
      ao(m);
    });
    porta.onDisconnect.addListener(() => {
      const erro = chrome.runtime.lastError?.message ?? "ponte fechou";
      if (!vivo) return resolve(null);
      void caiu(erro);
    });
    try {
      porta.postMessage(primeira);
    } catch {
      return resolve(null);
    }
    // ponte não instalada falha NA HORA (onDisconnect); este prazo é para a ponte instalada que não responde (o api
    // fora). Com a máquina carregada, subir o node da ponte passava de 3 s e a extensão caía para o WebSocket à toa
    setTimeout(() => {
      if (!vivo) {
        try {
          porta.disconnect();
        } catch {
          /* já fechou */
        }
        resolve(null);
      }
    }, 10_000);
  });
}

function abrirWebSocket(url: string, primeira: unknown): Promise<Canal | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return resolve(null);
    }
    let aberto = false;
    ws.onopen = () => {
      aberto = true;
      // o token vai na PRIMEIRA mensagem, nunca na URL
      ws.send(JSON.stringify(primeira));
      resolve({
        enviar: (m) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
        },
        fechar: () => ws.close(),
      });
    };
    ws.onmessage = (ev) => {
      try {
        ao(JSON.parse(String(ev.data)));
      } catch {
        /* lixo: ignora */
      }
    };
    ws.onclose = (ev) => {
      if (!aberto) return resolve(null);
      void caiu(ev.reason || `fechado (${ev.code})`);
    };
    ws.onerror = () => {
      if (!aberto) resolve(null);
    };
  });
}

async function conectar(): Promise<void> {
  if (canal || conectando) return;
  const [l, e0] = await Promise.all([local(), ler()]);
  if (!l.token && !pareandoCom) return;
  // o token foi recusado seguidas vezes (revogado na tela com a extensão fora): não insiste, pede um pareamento novo
  if (!pareandoCom && e0.recusasDoToken >= RECUSAS_PARA_DESISTIR) return;
  conectando = true;
  try {
    const primeira = pareandoCom
      ? { t: "parear", codigo: pareandoCom, nome: NOME_DO_CHROME, versao: VERSAO, ...(l.token ? { tokenAnterior: l.token } : {}) }
      : { t: "ola", token: l.token, versao: VERSAO, nome: NOME_DO_CHROME, perfil: "real" };
    const e = await ler();
    let via: EstadoDaSessao["via"] = null;
    // B7: a ponte primeiro (só esta extensão fala com ela, por construção); se não houver, o WebSocket
    let c = Date.now() - e.nativoFalhouEm > 5 * 60_000 ? await abrirNativo(primeira) : null;
    if (c) via = "nativo";
    else {
      if (Date.now() - e.nativoFalhouEm > 5 * 60_000) await gravar({ nativoFalhouEm: Date.now() });
      c = await abrirWebSocket(l.apiUrl || URL_PADRAO, primeira);
      if (c) via = "websocket";
    }
    if (!c) {
      await gravar({ conectado: false, via: null, ultimoErro: "A Órbita não respondeu (o apps/api está de pé?)." });
      agendarReconexao();
      return;
    }
    canal = c;
    autenticado = false;
    pareandoCom = null;
    tentativas = 0;
    await gravar({ conectado: true, via, ultimoErro: null });
  } finally {
    conectando = false;
  }
}

function agendarReconexao(): void {
  const espera = [1000, 2000, 5000, 10000, 30000][Math.min(tentativas++, 4)]!;
  setTimeout(() => void conectar(), espera);
}

async function caiu(motivo: string): Promise<void> {
  canal = null;
  autenticado = false;
  if (relogioPing) clearInterval(relogioPing);
  relogioPing = null;
  await gravar({ conectado: false, via: null, ultimoErro: motivo });
  if ((await local()).token) agendarReconexao();
}

function responder(id: string, ok: boolean, dados?: unknown, erro?: string, codigo?: string): void {
  canal?.enviar({ t: "resposta", id, ok, ...(dados ? { dados } : {}), ...(erro ? { erro: erro.slice(0, 3000) } : {}), ...(codigo ? { codigo } : {}) });
}

function evento(tipo: "dono_mexeu" | "parar" | "redirecionou" | "aba_no_grupo" | "borda_escondida", extra: { aba?: number; dominio?: string; detalhe?: string } = {}): void {
  if (autenticado) canal?.enviar({ t: "evento", tipo, ...extra });
}

/**
 * Parar e "o dono mexeu" com sessão: guardados ANTES de tentar mandar, e
 * reenviados até o core confirmar. O Parar que se perdia com o canal caído era
 * desfeito na reconexão (o api ainda achava a sessão ativa e a extensão voltava
 * a agir). Sem sessão não há o que parar no core: vai uma vez e pronto.
 */
async function eventoGuardado(tipo: EventoPendente["tipo"], sessaoId: string | null, extra: { aba?: number; detalhe?: string } = {}): Promise<void> {
  if (!sessaoId) {
    evento(tipo, extra);
    return;
  }
  const p: EventoPendente = { id: crypto.randomUUID(), tipo, sessaoId, em: Date.now(), ...extra };
  await mudar((e) => ({ pendentes: [...e.pendentes.filter((x) => !(x.tipo === tipo && x.sessaoId === sessaoId)), p].slice(-20) }));
  enviarPendentes();
}

function enviarPendentes(): void {
  if (!autenticado || !canal) return;
  void ler().then((e) => {
    for (const p of e.pendentes) canal?.enviar({ t: "evento", tipo: p.tipo, id: p.id, sessaoId: p.sessaoId, em: p.em, ...(p.aba !== undefined ? { aba: p.aba } : {}), ...(p.detalhe ? { detalhe: p.detalhe } : {}) });
  });
}

/** O envelope vale para agir AGORA? Ativo aqui, não parado, no prazo e abaixo do teto (com os passos contados aqui). */
function envelopeValido(e: EstadoDaSessao): EnvelopeDaExtensao | null {
  const env = e.envelope;
  if (!env || e.parado) return null;
  if (!(Date.parse(env.expiraEm) > Date.now())) return null;
  if (env.passosUsados + e.passosLocais >= env.tetoPassos) return null;
  return env;
}

async function receber(raw: unknown): Promise<void> {
  const m = raw as MensagemParaExtensao;
  switch (m.t) {
    case "pareado":
      await chrome.storage.local.set({ token: m.token });
      await gravar({ recusasDoToken: 0 });
      autenticado = true;
      return;
    case "recusado": {
      // token recusado: conta; passou do limite, para de tentar (o popup diz para parear de novo)
      const e = await mudar((x) => ({ ultimoErro: m.motivo, recusasDoToken: x.recusasDoToken + 1 }));
      if (e.recusasDoToken >= RECUSAS_PARA_DESISTIR) await gravar({ ultimoErro: "A Órbita recusou o pareamento desta extensão (revogado ou vencido). Gere um código novo na tela e pareie de novo." });
      return;
    }
    case "revogado":
      // o dono revogou na tela (ou esqueceu no popup): esquece o token e para de tentar
      await chrome.storage.local.remove("token");
      await gravar({ ultimoErro: m.motivo, conectado: false, recusasDoToken: 0 });
      await encerrarSessaoLocal("revogada", true);
      canal?.fechar();
      canal = null;
      autenticado = false;
      return;
    case "bem_vindo": {
      autenticado = true;
      const atual = await ler();
      const pendenteDeParar = atual.pendentes.some((p) => p.tipo === "parar");
      // B-3: o bem-vindo NUNCA desfaz um Parar. Envelope da sessão que parou aqui (o core ainda não sabia) não
      // revive; com o Parar pendente, nem envelope nenhum vale até o core confirmar.
      const envelopeQueVale = m.envelope && m.envelope.sessaoId !== atual.sessaoEncerrada && !pendenteDeParar && !atual.parado ? m.envelope : null;
      await gravar({ sites: m.sites, corDoGrupo: m.corDoGrupo, agindoMs: m.agindoMs, keepaliveSeg: m.keepaliveSeg, envelope: envelopeQueVale, recusasDoToken: 0 });
      if (relogioPing) clearInterval(relogioPing);
      relogioPing = setInterval(() => canal?.enviar({ t: "ping" }), Math.max(5, Math.min(m.keepaliveSeg, 25)) * 1000);
      // sem sessão no api: o depurador sai e o grupo é desfeito (I-10), como num fim
      if (!m.envelope) await encerrarSessaoLocal("sem sessão no api", true);
      await atualizarBordas();
      // os pendentes saem PRIMEIRO: o core para a sessão antes de qualquer ordem dela ser aceita aqui
      enviarPendentes();
      return;
    }
    case "envelope": {
      const atual = await ler();
      // o envelope de uma sessão que já parou aqui não a revive (reenvio de sites, reconexão)
      if (m.envelope.sessaoId === atual.sessaoEncerrada) {
        await gravar({ sites: m.sites });
        enviarPendentes();
        return;
      }
      const nova = m.envelope.sessaoId !== atual.envelope?.sessaoId;
      // sessão NOVA começa com o grupo vazio: as abas de uma sessão pausada não entram no escopo da seguinte sozinhas
      // (quem põe uma aba no escopo é o dono, arrastando)
      if (nova && !atual.envelope && (await grupoValido(atual.grupoId)) !== null) {
        const velhas = (await abasDoGrupo()).map((t) => t.id).filter((x): x is number => typeof x === "number");
        if (velhas.length) await semTravar(chrome.tabs.ungroup(velhas as [number, ...number[]]));
        await gravar({ grupoId: null });
      }
      await gravar({ envelope: m.envelope, sites: m.sites, parado: false, sessaoEncerrada: null, ...(nova ? { passosLocais: 0 } : {}) });
      await atualizarBordas();
      return;
    }
    case "fim": {
      const e = await ler();
      // o que estava pendente desta sessão não importa mais: ela acabou
      await mudar((x) => ({ pendentes: x.pendentes.filter((p) => p.sessaoId !== m.sessaoId), ...(x.envelope?.sessaoId === m.sessaoId || !x.envelope ? { sessaoEncerrada: m.sessaoId } : {}) }));
      if (e.envelope?.sessaoId === m.sessaoId) await encerrarSessaoLocal(m.status, m.status !== "pausada");
      return;
    }
    case "parar": {
      const e = await ler();
      await gravar({ parado: true, sessaoEncerrada: e.envelope?.sessaoId ?? e.sessaoEncerrada });
      await encerrarSessaoLocal("parada", true);
      return;
    }
    case "evento_recebido":
      await mudar((e) => ({ pendentes: e.pendentes.filter((p) => p.id !== m.id) }));
      return;
    case "ordem":
      return tratarOrdem(m.id, m.origem, m.ordem);
    case "pong":
      return;
  }
}

// ── grupo de abas, depurador e borda ────────────────────────────────────────
/**
 * Chamada ao Chrome que pode não voltar nunca (uma aba congelada em segundo
 * plano, um quadro ainda carregando): roda com prazo. Sem isto, um aviso de
 * borda preso travava a FILA de estado inteira, e toda ordem depois dele
 * estourava o tempo.
 */
function semTravar<T>(p: Promise<T>, ms = 2000): Promise<T | undefined> {
  return Promise.race([p.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

async function grupoValido(id: number | null): Promise<number | null> {
  if (id === null || id < 0) return null;
  try {
    await chrome.tabGroups.get(id);
    return id;
  } catch {
    return null;
  }
}

/** Põe a aba no grupo da sessão. `renomear: false` (aba só de leitura) não troca o título do grupo. */
async function porNoGrupo(tabId: number, titulo: string, renomear = true): Promise<number> {
  const e = await ler();
  const atual = await grupoValido(e.grupoId);
  const grupoId = atual !== null ? await chrome.tabs.group({ tabIds: [tabId], groupId: atual }) : await chrome.tabs.group({ tabIds: [tabId] });
  if (renomear || atual === null) await chrome.tabGroups.update(grupoId, { title: titulo.slice(0, 60), color: e.corDoGrupo as `${chrome.tabGroups.Color}`, collapsed: false });
  if (grupoId !== e.grupoId) await gravar({ grupoId });
  await mostrarBorda(tabId);
  return grupoId;
}

async function abasDoGrupo(): Promise<chrome.tabs.Tab[]> {
  const id = await grupoValido((await ler()).grupoId);
  return id === null ? [] : chrome.tabs.query({ groupId: id });
}

async function depurar(tabId: number): Promise<void> {
  const e = await ler();
  if (e.depurando.includes(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (err) {
    // já anexado por esta extensão (o service worker reiniciou): segue
    if (!String(err).includes("Another debugger is already attached")) throw err;
  }
  await mudar((x) => ({ depurando: [...new Set([...x.depurando, tabId])] }));
}

async function soltarDepuradores(): Promise<void> {
  const e = await ler();
  for (const tabId of e.depurando) await semTravar(chrome.debugger.detach({ tabId }));
  await gravar({ depurando: [] });
}

async function mostrarBorda(tabId: number): Promise<void> {
  const e = await ler();
  const ligar = !!e.envelope && !e.parado;
  await semTravar(chrome.tabs.sendMessage(tabId, { tipo: "orbita:borda", ligar, objetivo: e.envelope?.objetivo ?? "", cor: e.corDoGrupo }));
}

async function atualizarBordas(): Promise<void> {
  for (const t of await abasDoGrupo()) if (t.id) await mostrarBorda(t.id);
}

/**
 * Fim da sessão do lado da extensão: solta o depurador, tira a borda e desfaz
 * o grupo (as abas ficam abertas). Pausada, o grupo fica (o dono vê quais abas
 * eram da sessão) mas o título diz que está pausada, e nada age sem envelope.
 */
async function encerrarSessaoLocal(motivo: string, desfazerGrupo: boolean): Promise<void> {
  await soltarDepuradores();
  const abas = await abasDoGrupo();
  const antes = await ler();
  await gravar({ envelope: null });
  // (a fila de estado garante que um envelope novo chegado depois não é apagado aqui)
  for (const t of abas) if (t.id) await semTravar(chrome.tabs.sendMessage(t.id, { tipo: "orbita:borda", ligar: false, objetivo: "", cor: "" }));
  if (desfazerGrupo && abas.length) {
    const ids = abas.map((t) => t.id).filter((x): x is number => typeof x === "number");
    if (ids.length) await chrome.tabs.ungroup(ids as [number, ...number[]]).catch(() => undefined);
    await gravar({ grupoId: null });
  } else if (!desfazerGrupo && antes.grupoId !== null && abas.length) {
    await chrome.tabGroups.update(antes.grupoId, { title: `Órbita (pausada): ${(antes.envelope?.objetivo ?? "").slice(0, 40)}` }).catch(() => undefined);
  }
  console.info("[orbita] sessão encerrada:", motivo);
}

/** O botão Parar (na aba ou no painel), a faixa do depurador cancelada: corta AQUI primeiro, avisa o api depois. */
async function pararAqui(origem: string): Promise<void> {
  const e = await ler();
  const sessaoId = e.envelope?.sessaoId ?? null;
  await gravar({ parado: true, sessaoEncerrada: sessaoId ?? e.sessaoEncerrada });
  await encerrarSessaoLocal(origem, true);
  await eventoGuardado("parar", sessaoId, { detalhe: origem });
}

// ── as ordens ───────────────────────────────────────────────────────────────
class Recusa extends Error {
  constructor(
    message: string,
    public codigo = "recusado",
  ) {
    super(message);
  }
}

async function abaAlvo(aba?: number | null): Promise<chrome.tabs.Tab> {
  if (aba) {
    const t = await chrome.tabs.get(aba).catch(() => null);
    if (!t) throw new Recusa(`A aba ${aba} não existe mais.`, "sem_aba");
    return t;
  }
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t) throw new Recusa("Não há aba ativa.", "sem_aba");
  return t;
}

const semFragmento = (u: string) => u.replace(/#.*$/, "");

async function naPagina(tabId: number, p: PedidoNaPagina): Promise<RespostaNaPagina> {
  // mundo ISOLADO: o mapa de refs fica onde a página não alcança
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: orbitaNaPagina, args: [p] });
  return (r?.result as RespostaNaPagina) ?? { ok: false, erro: "A página não respondeu.", codigo: "invalido" };
}

/** O mesmo pedido em todos os quadros da aba (a máscara: o cartão no iframe do Stripe também some). */
async function emTodosOsQuadros(tabId: number, p: PedidoNaPagina): Promise<RespostaNaPagina[]> {
  const rs = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "ISOLATED", func: orbitaNaPagina, args: [p] });
  // quadro que não respondeu conta como falha: a máscara falha FECHADO no executor
  return rs.map((r) => (r?.result as RespostaNaPagina) ?? { ok: false, erro: "Um quadro da página não respondeu.", codigo: "invalido" });
}

function maosDe(tabId: number, agindoMs: number): MaosDaAba {
  return {
    cdp: (metodo, params) => {
      // a entrada da Órbita: um clique dentro de um iframe chega lá como confiável e sem a marca da página
      if (metodo.startsWith("Input.")) agindoAteSw = Date.now() + agindoMs;
      return chrome.debugger.sendCommand({ tabId }, metodo, params ?? {}) as Promise<unknown>;
    },
    pagina: (p) => naPagina(tabId, p),
    paginaEmTodosOsQuadros: (p) => emTodosOsQuadros(tabId, p),
  };
}

async function esperarCarregar(tabId: number, prazoMs = 15000): Promise<chrome.tabs.Tab> {
  const fim = Date.now() + prazoMs;
  for (;;) {
    const t = await chrome.tabs.get(tabId);
    if ((t.status === "complete" && t.url && t.url !== "about:blank") || Date.now() > fim) return t;
    await new Promise((r) => setTimeout(r, 150));
  }
}

function dominio(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Pode AGIR neste endereço? Precisa de um envelope que vale agora (I-10: antes
 * a lista "liberado para agir" do dono bastava, sem sessão nenhuma), e o site
 * no envelope ou liberado para agir. `aprovada` (o dono viu na fila) dispensa
 * a lista de sites, nunca o envelope.
 */
function podeAgir(url: string, e: EstadoDaSessao, aprovada: boolean): boolean {
  if (urlRecusadaPelasMaos(url, e.sites)) return false;
  const env = envelopeValido(e);
  if (!env) return false;
  if (aprovada) return true;
  return urlNaLista(url, env.sites) || urlNaLista(url, e.sites.escrita);
}

/** Pode ABRIR este endereço? Com envelope, como agir; sem envelope, só o que o dono aprovou na fila. */
function podeAbrir(url: string, e: EstadoDaSessao, aprovada: boolean): boolean {
  if (urlRecusadaPelasMaos(url, e.sites)) return false;
  if (aprovada && !e.parado) return true;
  return podeAgir(url, e, false);
}

async function noEscopo(t: chrome.tabs.Tab, e: EstadoDaSessao): Promise<boolean> {
  const g = await grupoValido(e.grupoId);
  return g !== null && t.groupId === g;
}

async function tratarOrdem(id: string, origem: OrigemDaOrdem, o: Ordem): Promise<void> {
  const inicio = Date.now();
  try {
    // B6: no Chrome do dono, só o dono manda. Rotina e regra vão ao perfil dedicado.
    if (origem !== "dono") throw new Recusa("Ordem de rotina ou regra recusada: no seu Chrome só você manda (rotina usa o perfil dedicado).", "origem_recusada");
    const r = await executar(o);
    responder(id, true, { ...r, ms: Date.now() - inicio });
  } catch (e) {
    const codigo = e instanceof Recusa || e instanceof RecusaDasMaos ? e.codigo : "falhou";
    responder(id, false, undefined, e instanceof Error ? e.message : String(e), codigo);
  }
}

async function executar(o: Ordem): Promise<ResultadoDaOrdem> {
  const e = await ler();
  const acoesDeMao = ["agir", "abrir", "historico", "fechar", "focar"];
  if (e.parado && acoesDeMao.includes(o.tipo)) throw new Recusa("Você apertou Parar: a Órbita não age até uma sessão nova.", "parado");
  // B-3: um Parar que o core ainda não confirmou vale como Parar
  if (e.pendentes.some((p) => p.tipo === "parar") && acoesDeMao.includes(o.tipo)) throw new Recusa("Você apertou Parar: a Órbita não age até uma sessão nova.", "parado");

  switch (o.tipo) {
    case "abas": {
      const g = await grupoValido(e.grupoId);
      const abas = await chrome.tabs.query({});
      return {
        abas: abas
          .filter((t) => t.id !== undefined)
          .map((t): AbaVista => {
            const url = t.url ?? t.pendingUrl ?? "";
            const bloqueada = urlRecusadaPelasMaos(url, e.sites);
            return { aba: t.id!, titulo: bloqueada ? "" : (t.title ?? ""), url: bloqueada ? "" : semFragmento(url), ativa: !!t.active, noGrupo: g !== null && t.groupId === g, ...(bloqueada ? { bloqueada: true } : {}) };
          }),
      };
    }
    case "abrir": {
      if (urlRecusadaPelasMaos(o.url, e.sites)) throw new Recusa("Site bloqueado para a Órbita.", "bloqueado");
      const pode = o.url === "about:blank" ? !!envelopeValido(e) || !!o.aprovada : o.paraLer || podeAbrir(o.url, e, !!o.aprovada);
      if (!pode) throw new Recusa(envelopeValido(e) ? "Esse site não está no envelope da sessão." : "Sem uma sessão de controle ativa (ou ela venceu, ou chegou ao teto): a Órbita não abre sozinha.", "fora_do_envelope");
      let tab: chrome.tabs.Tab;
      if (o.aba && !o.nova && !o.paraLer) {
        const atual = await abaAlvo(o.aba);
        if (!(await noEscopo(atual, e)) && !o.aprovada) throw new Recusa("Essa aba não é do grupo da Órbita. Arraste-a para o grupo ou abra uma nova.", "fora_do_escopo");
        const atualizada = await chrome.tabs.update(atual.id!, { url: o.url });
        if (!atualizada) throw new Recusa("Não consegui usar essa aba.", "sem_aba");
        tab = atualizada;
      } else {
        tab = await chrome.tabs.create({ url: o.url, active: !o.paraLer });
      }
      // aba só de leitura: entra no grupo da sessão que existir (sem renomear o grupo); sem sessão, fica sem grupo,
      // em vez de um "Órbita: leitura" que nunca mais sumia
      if (!o.paraLer) await porNoGrupo(tab.id!, o.grupo.titulo);
      else if (envelopeValido(e) && (await grupoValido(e.grupoId)) !== null) await porNoGrupo(tab.id!, o.grupo.titulo, false);
      const final = o.url === "about:blank" ? tab : await esperarCarregar(tab.id!);
      // a página carregou depois de entrar no grupo: a borda vai agora (o aviso de antes chegou antes do content script)
      if (!o.paraLer) await mostrarBorda(tab.id!);
      const url = final.url ?? o.url;
      if (urlRecusadaPelasMaos(url, e.sites)) {
        await chrome.tabs.update(tab.id!, { url: "about:blank" });
        throw new Recusa("O site redirecionou para um endereço bloqueado.", "bloqueado");
      }
      let redirecionou: string | null = null;
      if (o.url !== "about:blank" && dominio(url) !== dominio(o.url) && !podeAgir(url, e, false) && !o.paraLer) {
        redirecionou = dominio(url);
        evento("redirecionou", { aba: tab.id, dominio: redirecionou });
      }
      return { aba: tab.id, url: semFragmento(url), titulo: final.title ?? "", redirecionou };
    }
    case "historico": {
      const t = await abaAlvo(o.aba);
      if (!(await noEscopo(t, e))) throw new Recusa("Essa aba não é do grupo da Órbita.", "fora_do_escopo");
      if (!envelopeValido(e)) throw new Recusa("Sem uma sessão de controle ativa: a Órbita não navega sozinha.", "sem_sessao");
      if (o.direcao === "voltar") await chrome.tabs.goBack(t.id!);
      else if (o.direcao === "avancar") await chrome.tabs.goForward(t.id!);
      else await chrome.tabs.reload(t.id!);
      const f = await esperarCarregar(t.id!);
      if (urlRecusadaPelasMaos(f.url ?? "", e.sites)) {
        await chrome.tabs.update(t.id!, { url: "about:blank" }).catch(() => undefined);
        throw new Recusa("A página foi para um site bloqueado.", "bloqueado");
      }
      return { aba: f.id, url: semFragmento(f.url ?? ""), titulo: f.title ?? "" };
    }
    case "fechar": {
      const t = await abaAlvo(o.aba);
      if (!(await noEscopo(t, e))) throw new Recusa("Só fecho abas do grupo da Órbita.", "fora_do_escopo");
      await chrome.tabs.remove(t.id!);
      return { feito: "Aba fechada." };
    }
    case "focar": {
      const t = await abaAlvo(o.aba);
      if (!(await noEscopo(t, e))) throw new Recusa("Só ponho em foco abas do grupo da Órbita.", "fora_do_escopo");
      await chrome.tabs.update(t.id!, { active: true });
      if (t.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true }).catch(() => undefined);
      return { aba: t.id, url: semFragmento(t.url ?? ""), titulo: t.title ?? "" };
    }
    default:
      break;
  }

  const t = await abaAlvo("aba" in o ? o.aba : null);
  const url = t.url ?? "";
  // site bloqueado: nem o título sai daqui
  if (urlRecusadaPelasMaos(url, e.sites)) return { aba: t.id, bloqueada: true };

  switch (o.tipo) {
    case "ler": {
      const r = await naPagina(t.id!, { tipo: "ler", modo: o.modo, filtro: o.filtro, maxElementos: o.maxElementos, maxCaracteres: o.maxCaracteres, ref: o.ref ?? null });
      if (!r.ok) throw new Recusa(r.erro, r.codigo);
      return { aba: t.id, ...("leitura" in r ? { leitura: r.leitura } : {}) };
    }
    case "descrever":
    case "achar":
    case "focado": {
      const r = await naPagina(
        t.id!,
        o.tipo === "focado" ? { tipo: "focado" } : o.tipo === "achar" ? { tipo: "achar", papel: o.papel, nome: o.nome, texto: o.texto, seletor: o.seletor } : { tipo: "descrever", ref: o.ref ?? null, x: o.x ?? null, y: o.y ?? null },
      );
      if (!r.ok) throw new Recusa(r.erro, r.codigo);
      return { aba: t.id, url: semFragmento(url), alvo: "alvo" in r ? r.alvo : "focado" in r ? r.focado : null };
    }
    case "ver": {
      const jaDepurava = e.depurando.includes(t.id!);
      await depurar(t.id!);
      try {
        const img = await capturarAba(maosDe(t.id!, e.agindoMs), { larguraMax: o.larguraMax, regiao: o.regiao ?? null, miniatura: !!o.miniatura });
        // I-12: a aba pode ter navegado DURANTE a captura (para o banco, por exemplo). O endereço é lido de novo
        // depois, e a imagem é descartada se ele foi para site bloqueado ou para outro site
        const depois = await chrome.tabs.get(t.id!).catch(() => null);
        // `url` é o endereço já confirmado; `pendingUrl`, o que está carregando agora: os dois contam
        const enderecos = [depois?.url ?? "", depois?.pendingUrl ?? ""].filter(Boolean);
        if (!depois || !enderecos.length || enderecos.some((u) => urlRecusadaPelasMaos(u, e.sites))) return { aba: t.id, bloqueada: true };
        if (enderecos.some((u) => dominio(u) !== dominio(url))) throw new Recusa("A aba mudou de site durante a captura: a imagem foi descartada. Leia a página de novo.", "tela_mudou");
        return { aba: t.id, imagem: img, url: semFragmento(enderecos[0]!) };
      } finally {
        // fora de uma sessão a faixa do depurador não fica: solta logo depois da captura
        if (!jaDepurava && !(await ler()).envelope) {
          await semTravar(chrome.debugger.detach({ tabId: t.id! }));
          await mudar((x) => ({ depurando: x.depurando.filter((d) => d !== t.id) }));
        }
      }
    }
    case "agir": {
      // sem um envelope que vale agora, nada age (nem em site liberado para agir): é a primeira pergunta
      if (!envelopeValido(e)) throw new Recusa(e.envelope ? "A sessão de controle venceu ou chegou ao teto de passos: a Órbita não age mais nela." : "Sem uma sessão de controle ativa: a Órbita não age.", "sem_sessao");
      // I-13: aba do dono não entra no grupo sozinha, nem com site do envelope; quem arrasta é o dono (B1)
      if (!(await noEscopo(t, e)) && !o.aprovada) throw new Recusa("Essa aba não é do grupo da Órbita. Arraste-a para o grupo para ela entrar na sessão.", "fora_do_escopo");
      if (!podeAgir(url, e, !!o.aprovada)) throw new Recusa("Esse site não está no envelope da sessão.", "fora_do_envelope");
      await depurar(t.id!);
      await mudar((x) => ({ passosLocais: x.passosLocais + 1 }));
      // o endereço da aba AGORA: a ordem aprovada para outra página é recusada (tela_mudou) dentro do executarAgir
      const r = await executarAgir(maosDe(t.id!, e.agindoMs), o, { agindoMs: e.agindoMs, urlAtual: url });
      await new Promise((res) => setTimeout(res, 300));
      const f = await chrome.tabs.get(t.id!).catch(() => t);
      return { ...r, aba: t.id, url: semFragmento(f.url ?? url) };
    }
  }
  throw new Recusa("Ordem desconhecida.", "invalido");
}

// ── eventos do Chrome ───────────────────────────────────────────────────────
chrome.debugger.onDetach.addListener((fonte, motivo) => {
  void (async () => {
    const e = await ler();
    if (fonte.tabId !== undefined) await mudar((x) => ({ depurando: x.depurando.filter((d) => d !== fonte.tabId) }));
    // "Cancelar" na faixa amarela do Chrome é um botão de parar a mais (decisão do dono: a faixa fica)
    if (motivo === "canceled_by_user" && e.envelope) await pararAqui("faixa do depurador cancelada");
  })();
});

chrome.tabs.onUpdated.addListener((tabId, mudou) => {
  if (mudou.groupId === undefined) return;
  void (async () => {
    const e = await ler();
    const g = await grupoValido(e.grupoId);
    // o dono ARRASTOU uma aba para o grupo da Órbita: ela entra no escopo da sessão
    if (g !== null && mudou.groupId === g) {
      evento("aba_no_grupo", { aba: tabId });
      await mostrarBorda(tabId);
    }
  })();
});

chrome.runtime.onMessage.addListener((msg: { tipo?: string; codigo?: string; apiUrl?: string }, remetente, responderAoRemetente) => {
  // só a própria extensão fala aqui; e o content script (que roda dentro de um site de terceiro) não pareia,
  // não troca o endereço do api, não esquece o token nem lê o estado. A página da extensão se reconhece pela
  // URL, e não por `!sender.tab`: o popup aberto numa aba também tem `tab`, e o content script tem a URL do site.
  if (remetente.id !== chrome.runtime.id) return false;
  const daPaginaDaExtensao = (remetente.url ?? "").startsWith(chrome.runtime.getURL(""));
  if (SO_DA_EXTENSAO.has(msg?.tipo ?? "") && !daPaginaDaExtensao) {
    responderAoRemetente({ ok: false, erro: "Pedido recusado: só o popup da Órbita faz isto." });
    return false;
  }
  void (async () => {
    switch (msg.tipo) {
      case "orbita:estado-da-aba": {
        const e = await ler();
        const tab = remetente.tab;
        const g = await grupoValido(e.grupoId);
        responderAoRemetente({ ligar: !!e.envelope && !e.parado && !!tab && g !== null && tab.groupId === g, objetivo: e.envelope?.objetivo ?? "", cor: e.corDoGrupo });
        return;
      }
      case "orbita:parar":
        await pararAqui(remetente.tab ? "botão Parar na aba" : "botão Parar no painel");
        responderAoRemetente({ ok: true });
        return;
      case "orbita:borda-escondida":
      case "orbita:dono-mexeu": {
        const escondida = msg.tipo === "orbita:borda-escondida";
        // a entrada da própria Órbita por CDP (o clique dentro de um iframe não tem a marca da página)
        if (!escondida && Date.now() < agindoAteSw) return responderAoRemetente({ ok: false });
        const e = await ler();
        const g = await grupoValido(e.grupoId);
        // só a aba do grupo conta: o dono mexendo nas abas dele não é com a Órbita
        if (!e.envelope || e.parado || !remetente.tab || g === null || remetente.tab.groupId !== g) return responderAoRemetente({ ok: false });
        const sessaoId = e.envelope.sessaoId;
        // o dono pegou o mouse (ou a página escondeu a borda): a Órbita solta (pausa), e só volta com uma sessão nova
        await gravar({ parado: true, sessaoEncerrada: sessaoId });
        await soltarDepuradores();
        await eventoGuardado(escondida ? "borda_escondida" : "dono_mexeu", sessaoId, { aba: remetente.tab.id });
        await atualizarBordas();
        responderAoRemetente({ ok: true });
        return;
      }
      case "orbita:parear": {
        if (!/^\d{6}$/.test(msg.codigo ?? "")) return responderAoRemetente({ ok: false, erro: "O código tem 6 dígitos." });
        canal?.fechar();
        canal = null;
        autenticado = false;
        pareandoCom = msg.codigo!;
        await gravar({ recusasDoToken: 0 });
        await conectar();
        responderAoRemetente({ ok: true });
        return;
      }
      case "orbita:endereco": {
        if (msg.apiUrl && !/^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/api\/navegador\/canal$/.test(msg.apiUrl)) return responderAoRemetente({ ok: false, erro: "Só endereço desta máquina (ws://127.0.0.1:3010/api/navegador/canal)." });
        await chrome.storage.local.set({ apiUrl: msg.apiUrl || URL_PADRAO });
        canal?.fechar();
        canal = null;
        autenticado = false;
        await gravar({ recusasDoToken: 0 });
        await conectar();
        responderAoRemetente({ ok: true });
        return;
      }
      case "orbita:esquecer": {
        // revoga no servidor quando dá (o token deixa de valer de verdade); sem canal, avisa que falta revogar na tela
        const revogouNoServidor = autenticado && !!canal;
        if (revogouNoServidor) canal!.enviar({ t: "esquecer" });
        await chrome.storage.local.remove("token");
        canal?.fechar();
        canal = null;
        autenticado = false;
        await gravar({ conectado: false, via: null, recusasDoToken: 0 });
        responderAoRemetente({ ok: true, revogouNoServidor, aviso: revogouNoServidor ? null : "A Órbita está fora do ar: o token foi apagado daqui, mas revogue também em Ajustes, Controle do PC." });
        return;
      }
      case "orbita:status": {
        const [e, l] = await Promise.all([ler(), local()]);
        responderAoRemetente({ conectado: e.conectado, via: e.via, pareado: !!l.token, envelope: e.envelope, parado: e.parado, pendentes: e.pendentes.length, ultimoErro: e.ultimoErro, apiUrl: l.apiUrl || URL_PADRAO, versao: VERSAO });
        return;
      }
    }
  })();
  return true;
});

chrome.alarms.create("orbita:acordar", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "orbita:acordar") void conectar();
});
chrome.runtime.onStartup.addListener(() => void conectar());
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  void conectar();
});
void conectar();
