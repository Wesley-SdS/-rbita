import type { BlocoClaude, MensagemClaude, PedidoClaudeDireto, RespostaClaudeDireto } from "@orbita/llm";
import { CHAVE_DA_IMAGEM, type ImagemParaModelo } from "../controle/imagem";
import { appNoEnvelope } from "../controle/envelope";
import { erroDaTool } from "../navegador/motor";
import type { Aprovacao } from "../navegador/motor";
import { blocoDeImagem, contextoDaResposta, PEDIDO_DE_RESUMO, podarCapturas, precisaCompactar, recomecarComResumo, tokensDaResposta } from "./contexto";
import type { CapturaVista } from "./escala";
import { ferramentasDoComputador, traduzirMembro, type PassoDoMotor } from "./membros";
import { systemDoMotor } from "./system";

/**
 * TAREFA DELEGADA NO WINDOWS (PRD-MOTOR-DESKTOP): o objetivo vai para um laço
 * próprio, com o Claude da assinatura dirigindo pelo `computer_toolset_20260801`.
 * É o mesmo desenho do motor do Chrome (`navegador/motor.ts`).
 *
 * O Claude NÃO toca no computador: ele diz o que fazer, e cada ação vira UMA
 * chamada às tools do registro (`computador_ver`, `computador_agir`) por
 * `deps.tool`, que é `executarPeloRegistro`. Sessão, envelope, risco pelo alvo
 * (as mãos descrevem o que há no ponto clicado), crítico, fila e trilha valem
 * igual a quando o dono pede direto. O laço só enxerga o toolset do computador:
 * não há terminal, arquivos, envio nem MCP aqui, senão o texto numa janela
 * mandaria rodar comando.
 *
 * O motor executa, não decide permissão: qualquer recusa das tools volta ao
 * Claude como erro, e ele nunca amplia envelope.
 */

export interface CfgDoComputador {
  modelo: string;
  modeloEscalada: string;
  escalarParaOpus: boolean;
  usarClaude: boolean;
  passosMax: number;
  capturas: number;
  contextoMaxTokens: number;
  tokensMax: number;
  esperaAprovacaoMs: number;
  pausaEntrePassosMs: number;
  pausaMaxMs: number;
  esperaAbrirMs: number;
  travadoMs: number;
  apps: string[];
}

export interface JanelaResumo {
  janela: number;
  app: string;
  nomes: string[];
  foco: boolean;
  minimizada: boolean;
  elevada: boolean;
  oculta: boolean;
}

export type EstadoDaSessao = "ativa" | "pausada" | "parada" | "encerrada" | "sumiu";

export interface DependenciasDoComputador {
  chamarClaude: (p: PedidoClaudeDireto) => Promise<RespostaClaudeDireto>;
  /** uma tool do registro, pelo caminho de sempre (guarda, fila, trilha) */
  tool: (nome: string, entrada: Record<string, unknown>) => Promise<unknown>;
  esperarAprovacao: (acaoId: string, prazoMs: number) => Promise<Aprovacao>;
  estadoDaSessao: () => Promise<EstadoDaSessao>;
  cancelado: () => Promise<boolean>;
  avisar: (titulo: string, texto: string) => Promise<void>;
  dormir: (ms: number) => Promise<void>;
  progresso: (feito: number, total: number | null, passo: string) => Promise<void>;
  pausarSessao: (motivo: string) => Promise<void>;
  /** só LEITURA, para achar a janela do envelope que perdeu o foco: nunca para agir */
  janelas: () => Promise<JanelaResumo[]>;
  /** sem o Claude: o laço com as tools da Órbita e o modelo da casa */
  motorDaOrbita: (objetivo: string, contexto: string) => Promise<string>;
  /** corta a chamada em andamento quando o dono manda parar */
  sinal?: AbortSignal;
  registrarUso?: (uso: RespostaClaudeDireto["usage"], modelo: string) => void;
}

export interface ResultadoDaTarefa {
  estado: "concluida" | "pausada" | "parada" | "falhou";
  resumo: string;
  tokens: number;
  acoes: number;
  motor: "claude" | "orbita";
}

type TipoDeErro = "elevacao" | "senha" | "sessao" | "travado" | "janela" | "alvo" | "outro";

interface Parada {
  estado: "pausada" | "parada" | "falhou";
  motivo: string;
}

export interface Estado {
  captura: CapturaVista | null;
  ultimaImagem: ImagemParaModelo | null;
  acoes: number;
  parar: Parada | null;
  fator: number;
  modelo: string;
  escalou: boolean;
  focou: boolean;
  erro: { tipo: TipoDeErro; n: number } | null;
}

export interface ResultadoDoMembro {
  conteudo: BlocoClaude[] | string;
  erro?: boolean;
}

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const txt = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v ?? null).slice(0, 2000));

/** Membros que só olham ou esperam: não gastam ação do teto. */
const LEITURA = new Set(["screenshot", "zoom", "cursor_position", "wait"]);

class ParadoPeloDono extends Error {
  constructor() {
    super("parado pelo dono");
    this.name = "AbortError";
  }
}

/** A chamada às mãos não é interrompível (uma captura leva segundos): o laço larga a espera na hora do parar. */
function contraOAborto<T>(p: Promise<T>, sinal: AbortSignal | undefined): Promise<T> {
  if (!sinal) return p;
  if (sinal.aborted) return Promise.reject(new ParadoPeloDono());
  return new Promise<T>((ok, nao) => {
    const parar = () => nao(new ParadoPeloDono());
    sinal.addEventListener("abort", parar, { once: true });
    p.then(ok, nao).finally(() => sinal.removeEventListener("abort", parar));
  });
}

export const NAO_EXECUTADO = "Not executed: an earlier computer action in this turn failed.";

/** O tipo do erro de uma tool, pela frase que ela devolveu. Puro. */
export function classificarErro(t: string): TipoDeErro {
  if (/administrador|elevad|\bUAC\b|desktop seguro|secure desktop|tela de bloqueio/i.test(t)) return "elevacao";
  if (/campo de senha|nunca digita senha/i.test(t)) return "senha";
  if (/sess[ãa]o de controle|sess[ãa]o.*(n[ãa]o est[áa]|pausada|encerrada)/i.test(t)) return "sessao";
  if (/n[ãa]o responde|timeout|timed out|esgot/i.test(t)) return "travado";
  if (/n[ãa]o existe mais|perdeu o foco|outra janela|janela.*(sumiu|fechou)/i.test(t)) return "janela";
  if (/assinatura|a tela mudou|alvo|fora d[ao] (screenshot|imagem)|captura.*(n[ãa]o existe|10 minutos)|leitura da tela expirou|envelope/i.test(t)) return "alvo";
  return "outro";
}

const imagemDe = (r: Obj): ImagemParaModelo | null => {
  const i = r[CHAVE_DA_IMAGEM] as ImagemParaModelo | undefined;
  return i && typeof i.base64 === "string" ? i : null;
};

const capturaDe = (r: Obj): CapturaVista | null => {
  const c = r.captura;
  if (!ehObj(c) || typeof c.id !== "string" || typeof c.largura !== "number" || typeof c.altura !== "number") return null;
  return { id: c.id, largura: c.largura, altura: c.altura };
};

/** A entrada de `computador_agir` para um passo (sem os campos que o modelo não preenche). */
export function entradaDoPasso(p: PassoDoMotor): Obj {
  const o: Obj = { acao: p.acao };
  if (p.alvo) o.alvo = p.alvo;
  if (p.destino) o.destino = p.destino;
  if (p.texto !== undefined) o.texto = p.texto;
  if (p.tecla !== undefined) o.tecla = p.tecla;
  if (p.direcao) o.direcao = p.direcao;
  if (p.quantidade) o.quantidade = p.quantidade;
  if (p.modificadores) o.modificadores = p.modificadores;
  return o;
}

const falha = (t: string): ResultadoDoMembro => ({ conteudo: `Error: ${t}`, erro: true });

/** Tira a tela (ou o zoom de um trecho) pela tool de leitura. O screenshot inteiro vira a referência dos pontos. */
async function tirarTela(est: Estado, d: DependenciasDoComputador, regiao?: Obj): Promise<ResultadoDoMembro> {
  const r = await d.tool("computador_ver", { acao: "tela", ...(regiao ? { regiao } : {}), ...(est.fator < 1 ? { reducao: est.fator } : {}) });
  const e = erroDaTool(r);
  if (e) return falha(e);
  const o = ehObj(r) ? r : {};
  const img = imagemDe(o);
  if (!img) return falha("A captura da tela não veio.");
  if (!regiao) {
    est.ultimaImagem = img;
    const c = capturaDe(o);
    if (c) est.captura = c;
  }
  return { conteudo: [blocoDeImagem(img)] };
}

/** A tela depois de uma ação, junto da frase dela. A falha do screenshot não derruba a ação que já aconteceu. */
async function comTelaNova(texto: string, est: Estado, d: DependenciasDoComputador, cfg: CfgDoComputador): Promise<ResultadoDoMembro> {
  if (cfg.pausaEntrePassosMs) await d.dormir(cfg.pausaEntrePassosMs);
  const t = await tirarTela(est, d);
  return { conteudo: [{ type: "text", text: texto }, ...(typeof t.conteudo === "string" ? [{ type: "text", text: "(não consegui tirar o screenshot agora)" }] : t.conteudo)] };
}

/** Janela do envelope que perdeu o foco: traz de volta UMA vez. Devolve o app, ou null. */
async function focarJanela(est: Estado, d: DependenciasDoComputador, cfg: CfgDoComputador): Promise<string | null> {
  if (est.focou) return null;
  est.focou = true;
  const js = await d.janelas().catch(() => [] as JanelaResumo[]);
  const alvo = js.filter((j) => !j.oculta && !j.elevada && !j.foco && j.nomes.some((n) => appNoEnvelope(n, cfg.apps))).sort((a, b) => Number(a.minimizada) - Number(b.minimizada))[0];
  if (!alvo) return null;
  const r = await d.tool("computador_abrir", { tipo: "janela", alvo: String(alvo.janela) });
  return erroDaTool(r) ? null : alvo.app;
}

/** Registra o erro e decide se a tarefa para (alvo/outro repetido; escalada de modelo opcional). */
function contarErro(tipo: TipoDeErro, est: Estado, cfg: CfgDoComputador): "seguir" | "escalou" | "parar" {
  est.erro = est.erro?.tipo === tipo ? { tipo, n: est.erro.n + 1 } : { tipo, n: 1 };
  if (tipo !== "alvo" && tipo !== "outro") return "seguir";
  if (est.erro.n < (est.escalou ? 1 : 2)) return "seguir";
  if (cfg.escalarParaOpus && !est.escalou && est.modelo !== cfg.modeloEscalada) {
    est.escalou = true;
    est.modelo = cfg.modeloEscalada;
    est.erro = null;
    return "escalou";
  }
  return "parar";
}

/**
 * Traduz UM membro do toolset em chamada ao registro. Devolve o conteúdo do
 * `tool_result`. Nunca lança: erro vira resultado com `erro`.
 */
export async function executarMembro(nome: string, entrada: Obj, est: Estado, d: DependenciasDoComputador, cfg: CfgDoComputador): Promise<ResultadoDoMembro> {
  const plano = traduzirMembro(nome, entrada, est.captura, cfg.pausaMaxMs);
  switch (plano.tipo) {
    case "erro":
      return falha(plano.texto);
    case "tela":
      return tirarTela(est, d);
    case "zoom":
      return tirarTela(est, d, plano.regiao);
    case "cursor": {
      if (!est.captura) return falha("Ainda não há captura da tela. Peça um screenshot antes.");
      const r = await d.tool("computador_ver", { acao: "cursor", captura: est.captura.id });
      const e = erroDaTool(r);
      return e ? falha(e) : { conteudo: [{ type: "text", text: txt(ehObj(r) ? (r.cursor ?? r) : r) }] };
    }
    case "esperar":
      await d.dormir(plano.seg * 1000);
      return comTelaNova(`Esperei ${plano.seg} s.`, est, d, cfg);
    case "agir":
      return acaoNaTela("computador_agir", entradaDoPasso(plano.passo), 0, est, d, cfg);
    case "abrir":
      // o app leva um tempo para aparecer: a tela nova só depois dessa espera
      return acaoNaTela("computador_abrir", { tipo: "app", alvo: plano.app }, cfg.esperaAbrirMs, est, d, cfg);
  }
}

/** Uma tool que MUDA a tela (agir ou abrir), pelo registro: proposta espera o dono, erro volta ao Claude, acerto traz a tela nova. */
async function acaoNaTela(tool: string, entrada: Obj, esperaMs: number, est: Estado, d: DependenciasDoComputador, cfg: CfgDoComputador): Promise<ResultadoDoMembro> {
  let r = await d.tool(tool, entrada);
  let e = erroDaTool(r);

  // app que não responde: espera o tempo configurado e tenta a MESMA ação mais uma vez
  if (e && classificarErro(e) === "travado") {
    await d.progresso(est.acoes, null, "esperando o app responder");
    await d.dormir(cfg.travadoMs);
    r = await d.tool(tool, entrada);
    e = erroDaTool(r);
    if (e && classificarErro(e) === "travado") {
      est.parar = { estado: "pausada", motivo: `o app não está respondendo (esperei ${Math.round(cfg.travadoMs / 1000)} s)` };
      return falha(e);
    }
  }

  if (ehObj(r) && r.proposta_enfileirada === true) {
    const resumo = txt(r.resumo);
    await d.avisar("A tarefa no Windows espera você", `Para continuar, aprove: ${resumo}`);
    await d.progresso(est.acoes, null, `esperando aprovação: ${resumo.slice(0, 80)}`);
    const a = await d.esperarAprovacao(String(r.id ?? ""), cfg.esperaAprovacaoMs);
    if (a.status !== "executada") {
      est.parar = { estado: "pausada", motivo: a.status === "recusada" ? `o dono não aprovou: ${resumo}` : `a aprovação de "${resumo}" não veio a tempo` };
      return { conteudo: `Não foi aprovado (${a.status}). Pare aqui.`, erro: true };
    }
    est.acoes++;
    est.erro = null;
    // a tela pode ter mudado enquanto o dono decidia: olha de novo antes de seguir
    return comTelaNova(`O dono aprovou e a ação foi executada: ${a.resultado.slice(0, 500).replace(/[.\s]+$/, "")}. A tela pode ter mudado; confira no screenshot.`, est, d, cfg);
  }

  if (e) return tratarErro(e, est, d, cfg);
  est.acoes++;
  est.erro = null;
  est.focou = false;
  if (esperaMs) await d.dormir(esperaMs);
  return comTelaNova(txt(ehObj(r) ? r.mensagem ?? "Feito." : "Feito."), est, d, cfg);
}

async function tratarErro(e: string, est: Estado, d: DependenciasDoComputador, cfg: CfgDoComputador): Promise<ResultadoDoMembro> {
  const tipo = classificarErro(e);
  if (tipo === "elevacao") {
    est.parar = { estado: "pausada", motivo: "apareceu uma tela de administrador (UAC) ou uma janela elevada. Preciso que você aprove ou recuse" };
    return falha(e);
  }
  if (tipo === "senha") {
    est.parar = { estado: "pausada", motivo: "a tela pede senha, e a Órbita nunca digita senha. Digite você e peça de novo para eu continuar" };
    return falha(e);
  }
  if (tipo === "sessao") {
    const s = await d.estadoDaSessao();
    est.parar = { estado: s === "pausada" ? "pausada" : "parada", motivo: "a sessão de controle não está mais ativa" };
    return falha(e);
  }
  if (tipo === "janela") {
    const app = await focarJanela(est, d, cfg);
    if (app) return falha(`${e} Trouxe a janela de ${app} de volta para a frente: veja a tela e tente de novo.`);
    est.parar = { estado: "pausada", motivo: `a janela do app sumiu ou perdeu o foco e não consegui trazer de volta (${e.slice(0, 120)})` };
    return falha(e);
  }
  const c = contarErro(tipo, est, cfg);
  if (c === "parar") est.parar = { estado: "falhou", motivo: `a mesma falha se repetiu: ${e.slice(0, 160)}` };
  if (c === "escalou") return falha(`${e} (vou tentar de novo com um modelo mais forte)`);
  return falha(e);
}

const estadoDaParada = (s: EstadoDaSessao): Parada => ({ estado: s === "pausada" ? "pausada" : "parada", motivo: s === "pausada" ? "a sessão de controle foi pausada" : "a sessão de controle acabou (parada ou encerrada)" });

function resultado(estado: ResultadoDaTarefa["estado"], resumo: string, tokens: number, est: Estado): ResultadoDaTarefa {
  return { estado, resumo, tokens, acoes: est.acoes, motor: "claude" };
}

const ehAborto = (e: unknown) => e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
const statusDe = (e: unknown): number => (e && typeof e === "object" && typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : 0);

/** Uma chamada ao Claude: espera e repete limite de uso e erro de servidor (3 vezes), e a resposta vazia (1 vez). */
async function chamar(pedido: PedidoClaudeDireto, d: DependenciasDoComputador): Promise<RespostaClaudeDireto> {
  let rede = 0;
  let vazias = 0;
  for (;;) {
    let resp: RespostaClaudeDireto;
    try {
      resp = await d.chamarClaude(pedido);
    } catch (e) {
      const s = statusDe(e);
      if (!ehAborto(e) && (s === 429 || s === 529 || s >= 500) && rede < 3) {
        await d.dormir(2000 * 2 ** rede++);
        continue;
      }
      throw e;
    }
    const esperado = resp.stop_reason === "end_turn" || resp.stop_reason === "tool_use";
    if ((!resp.content.length || !esperado) && vazias < 1) {
      vazias++;
      continue;
    }
    return resp;
  }
}

/** O histórico sem as imagens da última mensagem, para repetir a chamada com uma captura menor. */
function trocarImagensDaUltima(msgs: MensagemClaude[], aviso: string): void {
  const m = msgs.at(-1);
  if (!m || m.role !== "user" || typeof m.content === "string") return;
  for (const b of m.content) {
    if (b.type !== "tool_result" || !Array.isArray(b.content)) continue;
    b.content = (b.content as BlocoClaude[]).map((x) => (x.type === "image" ? { type: "text", text: aviso } : x));
  }
}

/** O laço inteiro. Nunca lança: o resultado diz como acabou. */
export async function rodarTarefa(p: { objetivo: string; pedido: string }, deps: DependenciasDoComputador, cfg: CfgDoComputador): Promise<ResultadoDaTarefa> {
  // toda tool passa pela corrida contra o parar: a captura leva segundos e o corte não espera por ela
  const d: DependenciasDoComputador = { ...deps, tool: (nome, entrada) => contraOAborto(deps.tool(nome, entrada), deps.sinal) };
  const est: Estado = { captura: null, ultimaImagem: null, acoes: 0, parar: null, fator: 1, modelo: cfg.modelo, escalou: false, focou: false, erro: null };
  let tokens = 0;

  const daOrbita = async (contexto: string): Promise<ResultadoDaTarefa> => {
    const texto = await d.motorDaOrbita(p.objetivo, contexto).catch((e) => `Não consegui: ${e instanceof Error ? e.message : String(e)}`);
    return { estado: "concluida", resumo: texto, tokens, acoes: est.acoes, motor: "orbita" };
  };

  if (!cfg.usarClaude) return daOrbita("");

  const sessao0 = await d.estadoDaSessao();
  if (sessao0 !== "ativa") return resultado("parada", "A sessão de controle não está ativa. Abra uma com o envelope e peça de novo.", 0, est);

  // o Claude não começa às cegas: a primeira mensagem já leva a tela
  const inicial = await tirarTela(est, d).catch((e): ResultadoDoMembro => (ehAborto(e) ? { conteudo: "Error: parado pelo dono", erro: true } : falha(e instanceof Error ? e.message : String(e))));
  if (inicial.erro && (await d.estadoDaSessao()) !== "ativa") return resultado("parada", "Parei: a sessão de controle acabou (parada ou encerrada).", 0, est);
  if (inicial.erro || typeof inicial.conteudo === "string") {
    const motivo = typeof inicial.conteudo === "string" ? inicial.conteudo : "sem captura";
    return resultado("falhou", `Não consegui ver a tela para começar: ${motivo.replace(/^Error: /, "")}`, 0, est);
  }
  let msgs: MensagemClaude[] = [{ role: "user", content: [{ type: "text", text: `Comece. Objetivo: ${p.objetivo}` }, ...inicial.conteudo] }];
  const system = systemDoMotor({ objetivo: p.objetivo, pedido: p.pedido, apps: cfg.apps, passosMax: cfg.passosMax });
  const tools = ferramentasDoComputador();
  const rodadasMax = cfg.passosMax * 3 + 5;
  let ultimoContexto = 0;
  let reduziu = false;

  for (let rodada = 0; rodada < rodadasMax; rodada++) {
    if (await d.cancelado()) return resultado("parada", "Tarefa cancelada.", tokens, est);
    const sessao = await d.estadoDaSessao();
    if (sessao !== "ativa") return resultado(estadoDaParada(sessao).estado, `Parei: ${estadoDaParada(sessao).motivo}.`, tokens, est);
    if (tokens >= cfg.tokensMax) {
      await d.pausarSessao("teto de tokens da tarefa");
      return resultado("pausada", `Cheguei ao teto de ${cfg.tokensMax} tokens e pausei a sessão.`, tokens, est);
    }
    await d.progresso(est.acoes, cfg.passosMax, `rodada ${rodada + 1}`);

    // perto do teto de contexto: o Claude resume o progresso e a tarefa recomeça só com ele e a última captura
    if (rodada > 0 && ultimoContexto > 0 && precisaCompactar({ input_tokens: ultimoContexto, output_tokens: 0 }, cfg.contextoMaxTokens)) {
      const copia = structuredClone(msgs);
      const ult = copia.at(-1);
      if (ult && ult.role === "user" && typeof ult.content !== "string") ult.content.push({ type: "text", text: PEDIDO_DE_RESUMO });
      const r = await chamar({ modelo: est.modelo, system, mensagens: copia, tools, maxTokens: 2048, signal: d.sinal, cachearPrefixo: true }, d).catch(() => null);
      const resumo = r?.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n").trim();
      if (r) {
        tokens += tokensDaResposta(r.usage);
        d.registrarUso?.(r.usage, est.modelo);
      }
      if (resumo) {
        msgs = recomecarComResumo(p.objetivo, resumo, est.ultimaImagem);
        ultimoContexto = 0;
      } else {
        podarCapturas(msgs, 1);
      }
    }

    let resp: RespostaClaudeDireto;
    try {
      resp = await chamar({ modelo: est.modelo, system, mensagens: podarCapturas(msgs, cfg.capturas), tools, maxTokens: 4096, signal: d.sinal, cachearPrefixo: true }, d);
    } catch (e) {
      if (ehAborto(e)) {
        if (await d.cancelado()) return resultado("parada", "Tarefa cancelada.", tokens, est);
        const s = await d.estadoDaSessao();
        return resultado(estadoDaParada(s).estado, `Parei: ${estadoDaParada(s).motivo}.`, tokens, est);
      }
      const s = statusDe(e);
      // imagem recusada por tamanho: uma vez, com a captura reduzida
      if (s === 400 && /image|imagem/i.test(e instanceof Error ? e.message : "") && !reduziu) {
        reduziu = true;
        est.fator = 0.5;
        trocarImagensDaUltima(msgs, "[captura removida: grande demais]");
        const nova = await tirarTela(est, d);
        const ult = msgs.at(-1);
        if (!nova.erro && typeof nova.conteudo !== "string" && ult && ult.role === "user" && typeof ult.content !== "string") ult.content.push(...nova.conteudo);
        continue;
      }
      // o Claude não está disponível na PRIMEIRA rodada (assinatura recusou, limite persistente): a tarefa segue com as tools da Órbita
      if (rodada === 0 && (s === 401 || s === 403 || s === 429 || s === 529 || s === 0)) return daOrbita("");
      const frase = s === 429 ? "O limite de uso da assinatura do Claude foi atingido." : `O Claude parou de responder (${e instanceof Error ? e.message.slice(0, 160) : "erro"}).`;
      return resultado("falhou", `${frase} A tarefa não terminou.`, tokens, est);
    }
    tokens += tokensDaResposta(resp.usage);
    ultimoContexto = contextoDaResposta(resp.usage);
    d.registrarUso?.(resp.usage, est.modelo);
    msgs.push({ role: "assistant", content: resp.content });

    const usos = resp.content.filter((b) => b.type === "tool_use");
    if (!usos.length) {
      const final = resp.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n").trim();
      if (!final) return resultado("falhou", "O Claude terminou sem dizer o que fez.", tokens, est);
      return resultado("concluida", final, tokens, est);
    }

    const resultados: BlocoClaude[] = [];
    let parouNoLote = false;
    for (const u of usos) {
      const base = { type: "tool_result", tool_use_id: u.id, ...(u.toolset_name ? { toolset_name: u.toolset_name } : {}) };
      if (parouNoLote || est.parar) {
        resultados.push({ ...base, is_error: true, content: NAO_EXECUTADO });
        continue;
      }
      // o dono pode ter mandado parar enquanto o lote andava
      const s = await d.estadoDaSessao();
      if (s !== "ativa" || (await d.cancelado())) {
        est.parar = s !== "ativa" ? estadoDaParada(s) : { estado: "parada", motivo: "a tarefa foi cancelada" };
        resultados.push({ ...base, is_error: true, content: NAO_EXECUTADO });
        continue;
      }
      // o teto vale na hora de AGIR: uma tarefa que termina exatamente no limite não é pausada à toa
      if (est.acoes >= cfg.passosMax && !LEITURA.has(String(u.name))) {
        await d.pausarSessao("teto de ações da tarefa");
        est.parar = { estado: "pausada", motivo: `cheguei ao teto de ${cfg.passosMax} ações e pausei a sessão. Ampliar é aprovar um envelope novo` };
        resultados.push({ ...base, is_error: true, content: NAO_EXECUTADO });
        continue;
      }
      const r = await executarMembro(String(u.name), ehObj(u.input) ? u.input : {}, est, d, cfg).catch((x): ResultadoDoMembro => falha(x instanceof Error ? x.message : String(x)));
      if (r.erro) parouNoLote = true;
      resultados.push({ ...base, ...(r.erro ? { is_error: true } : {}), content: r.conteudo });
    }
    msgs.push({ role: "user", content: resultados });
    if (est.parar) {
      return resultado(est.parar.estado, `Parei: ${est.parar.motivo}.`, tokens, est);
    }
  }
  return resultado("falhou", `Cheguei ao teto de ${rodadasMax} rodadas sem terminar.`, tokens, est);
}
