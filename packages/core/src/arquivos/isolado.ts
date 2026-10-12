import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { detectarTipo } from "./detectar";
import { tamanhoLegivel } from "./texto";
import { LeituraInterrompidaError, type Extraido, type Limites, type OpcoesDeExtracao, type TipoDetectado } from "./tipos";

/**
 * LEITURA DE ARQUIVO FORA DO LAÇO PRINCIPAL, com teto de tempo real (B5 da
 * revisão de 11/10/2026).
 *
 * O extrator universal lê arquivo de terceiro: anexo de e-mail, documento do
 * WhatsApp e do Telegram. Um parser que gaste CPU de forma síncrona (a regex
 * quadrática do XML levou 19 s com 470 bytes) parava o apps/api inteiro, e o
 * `anexos.esperarSeg` nem disparava, porque o `setTimeout` mora no mesmo laço
 * parado. Corrigir a regex resolve AQUELE parser; isto resolve a classe: a
 * leitura roda numa worker thread, o laço do api continua livre, e passando de
 * `anexos.tetoDaLeituraSeg` a thread é MORTA (não há como pedir educadamente a
 * um laço síncrono que pare).
 *
 * A thread fica quente para a próxima leitura: subir uma custa o import do
 * extrator inteiro (medido nesta máquina: ~10 s com tsx). Por isso o pool
 * guarda uma pronta, e no máximo `MAX_THREADS` leem ao mesmo tempo.
 *
 * Se a thread não sobe (sem o carregador de TypeScript, por exemplo), a
 * leitura roda no laço principal como antes e o log diz por quê: degradar a
 * proteção é melhor do que deixar de ler anexo.
 */

export type MensagemAoTrabalhador =
  | { t: "ler"; id: number; bytes: Uint8Array; opcoes: Omit<OpcoesDeExtracao, "progresso" | "sinal"> & { tipo?: TipoDetectado }; parado: boolean }
  | { t: "parar"; id: number };

export type MensagemDoTrabalhador =
  | { t: "pronto" }
  | { t: "progresso"; id: number; feito: number; total: number | null; passo: string }
  | { t: "fim"; id: number; r: Extraido }
  | { t: "erro"; id: number; nome: string; mensagem: string };

export interface OpcoesIsoladas extends Omit<OpcoesDeExtracao, "orcamento" | "profundidade"> {
  /** já detectado por quem chamou, para não ler a assinatura duas vezes */
  tipo?: TipoDetectado;
}

/** Leituras ao mesmo tempo, cada uma na sua thread (uma presa não segura as outras). */
const MAX_THREADS = 2;
/** Thread ociosa além da primeira morre depois disto: memória de volta, uma continua quente. */
const OCIOSA_MS = 60_000;

interface Thread {
  w: Worker;
  pronta: Promise<void>;
  ociosa?: ReturnType<typeof setTimeout>;
  /** o teto de memória com que ela subiu: mudou na tela, a próxima leitura sobe uma nova */
  memoriaMb: number;
}

const livres: Thread[] = [];
let emUso = 0;
const fila: (() => void)[] = [];
let proximoId = 1;
let avisouQueNaoSobe = false;

/** O arquivo da thread. Teste troca por outro (`_isolamentoEmTeste`) para simular um parser preso. */
let arquivoDaThread: URL = new URL("./isolado-trabalhador.ts", import.meta.url);
/**
 * Nos testes de unidade o extrator roda no laço do vitest, com os mocks de
 * cada arquivo (uma thread não vê `vi.mock`). O teste do isolamento liga a
 * thread de verdade com `_isolamentoEmTeste`.
 */
let isolar = !process.env.VITEST;

/**
 * O carregador de TypeScript para a thread. Rodando pelo tsx (o apps/api), a
 * thread herda o `execArgv` e já entende `.ts`. Fora dele (vitest), procura o
 * tsx do monorepo; sem achar, a thread falha ao subir e a leitura cai no laço
 * principal (ver o comentário do topo).
 */
function argvDaThread(): string[] | undefined {
  if (process.execArgv.some((a) => /tsx/.test(a))) return undefined;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    try {
      const pnpm = join(dir, "node_modules", ".pnpm");
      const tsx = readdirSync(pnpm).find((d) => d.startsWith("tsx@"));
      if (tsx) return ["--import", pathToFileURL(join(pnpm, tsx, "node_modules", "tsx", "dist", "loader.mjs")).href];
    } catch {
      /* não há node_modules aqui: sobe um nível */
    }
    const pai = dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return undefined;
}

/**
 * A thread sobe com teto de memória (`anexos.memoriaDaLeituraMb`). Sem ele, um
 * arquivo que infla além da conta (o texto de um ZIP de TXT repetido) levava a
 * thread a um OOM, e OOM numa worker sem limite derruba o PROCESSO inteiro (I5).
 * Com o teto, só a thread morre, e a leitura vira "não lido" com o motivo.
 */
function subirThread(memoriaMb: number): Thread {
  const w = new Worker(arquivoDaThread, { execArgv: argvDaThread(), resourceLimits: { maxOldGenerationSizeMb: memoriaMb, maxYoungGenerationSizeMb: Math.max(16, Math.round(memoriaMb / 16)) } });
  // a thread ociosa não segura o processo de pé (desligar o api não espera por ela)
  w.unref();
  const pronta = new Promise<void>((ok, falha) => {
    const aoMensagem = (m: MensagemDoTrabalhador) => {
      if (m.t !== "pronto") return;
      w.off("message", aoMensagem);
      w.off("error", falha);
      ok();
    };
    w.on("message", aoMensagem);
    w.once("error", falha);
    w.once("exit", (c) => falha(new Error(`a thread de leitura saiu com código ${c} antes de ficar pronta`)));
  });
  pronta.catch(() => undefined);
  return { w, pronta, memoriaMb };
}

async function pegarThread(memoriaMb: number): Promise<Thread> {
  if (emUso >= MAX_THREADS) await new Promise<void>((ok) => fila.push(ok));
  emUso++;
  const t = livres.pop();
  if (t) {
    clearTimeout(t.ociosa);
    if (t.memoriaMb === memoriaMb) return t;
    void t.w.terminate();
  }
  return subirThread(memoriaMb);
}

function devolverThread(t: Thread | null): void {
  emUso--;
  fila.shift()?.();
  if (!t) return;
  livres.push(t);
  // uma fica quente para sempre; as outras voltam a memória depois de um tempo paradas
  if (livres.length > 1) {
    t.ociosa = setTimeout(() => {
      const i = livres.indexOf(t);
      if (i !== -1) livres.splice(i, 1);
      void t.w.terminate();
    }, OCIOSA_MS);
    t.ociosa.unref();
  }
}

/** O resultado de quando o teto venceu: o arquivo é descrito, nunca lido. */
async function passouDoTeto(bytes: Buffer, opts: OpcoesIsoladas, tetoMs: number): Promise<Extraido> {
  const segundos = Math.round(tetoMs / 1000);
  return naoLidoPeloTeto(bytes, opts, (tipo) => `${tipo.ext.toUpperCase()} de ${tamanhoLegivel(bytes.length)}: a leitura passou de ${segundos} s e foi interrompida. O arquivo pode estar montado para travar o leitor; não foi lido.`, `Leitura interrompida depois de ${segundos} s (Ajustes, Anexos, "Tempo máximo de uma leitura").`);
}

/** A thread passou do teto de memória: morreu sozinha, o api seguiu. */
async function passouDaMemoria(bytes: Buffer, opts: OpcoesIsoladas, memoriaMb: number): Promise<Extraido> {
  return naoLidoPeloTeto(bytes, opts, (tipo) => `${tipo.ext.toUpperCase()} de ${tamanhoLegivel(bytes.length)}: a leitura passou de ${memoriaMb} MB de memória e foi interrompida. O arquivo pode estar montado para inflar além da conta; não foi lido.`, `Leitura interrompida no teto de memória (Ajustes, Anexos, "Memória de uma leitura").`);
}

async function naoLidoPeloTeto(bytes: Buffer, opts: OpcoesIsoladas, resumoDe: (tipo: TipoDetectado) => string, aviso: string): Promise<Extraido> {
  const tipo = opts.tipo ?? (await detectarTipo(bytes, opts.nome ?? "arquivo", opts.mimeDeclarado));
  const resumo = resumoDe(tipo);
  return {
    nome: (opts.nome ?? "arquivo").slice(0, 200),
    tipo,
    tamanho: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    lido: false,
    texto: "",
    partes: [],
    resumo,
    tabelas: 0,
    avisos: [aviso],
  };
}

/** Na thread, com o teto. `null`: a thread não subiu, e quem chamou lê no laço principal. */
async function naThread(bytes: Buffer, opts: OpcoesIsoladas, limites: Limites, tetoMs: number, memoriaMb: number): Promise<Extraido | null> {
  const t = await pegarThread(memoriaMb);
  try {
    await t.pronta;
  } catch (e) {
    devolverThread(null);
    void t.w.terminate();
    if (!avisouQueNaoSobe) {
      avisouQueNaoSobe = true;
      log.error("arquivos.isolado_nao_subiu", { erro: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    }
    return null;
  }

  const id = proximoId++;
  return new Promise<Extraido>((resolver, rejeitar) => {
    let acabou = false;
    const terminar = (matar: boolean, fim: () => void) => {
      if (acabou) return;
      acabou = true;
      clearTimeout(relogio);
      opts.sinal?.removeEventListener("abort", aoParar);
      t.w.off("message", aoMensagem);
      t.w.off("error", aoErro);
      t.w.off("exit", aoSair);
      if (matar) {
        void t.w.terminate();
        devolverThread(null);
      } else devolverThread(t);
      fim();
    };
    const aoMensagem = (m: MensagemDoTrabalhador) => {
      if (m.t === "pronto" || m.id !== id) return;
      if (m.t === "progresso") {
        // o progresso de um trabalho é também onde o pedido de parar dele aparece: se lançar, a leitura morre
        Promise.resolve(opts.progresso?.(m.feito, m.total, m.passo)).catch((e: unknown) => terminar(true, () => rejeitar(e)));
        return;
      }
      if (m.t === "fim") return terminar(false, () => resolver(m.r));
      terminar(false, () => rejeitar(m.nome === "LeituraInterrompidaError" ? new LeituraInterrompidaError() : new Error(m.mensagem)));
    };
    const aoErro = (e: Error) => {
      if ((e as { code?: string }).code === "ERR_WORKER_OUT_OF_MEMORY") {
        log.warn("arquivos.leitura_passou_da_memoria", { tipo: opts.tipo?.ext ?? null, tamanho: bytes.length, memoriaMb });
        return terminar(true, () => void passouDaMemoria(bytes, opts, memoriaMb).then(resolver, rejeitar));
      }
      terminar(true, () => rejeitar(e));
    };
    const aoSair = (c: number) => terminar(true, () => rejeitar(new Error(`a thread de leitura saiu com código ${c}`)));
    // quem pediu desistiu de esperar: a thread para no próximo ponto seguro, como no laço principal
    const aoParar = () => t.w.postMessage({ t: "parar", id } satisfies MensagemAoTrabalhador);
    const relogio = setTimeout(() => {
      log.warn("arquivos.leitura_passou_do_teto", { tipo: opts.tipo?.ext ?? null, tamanho: bytes.length, tetoMs });
      terminar(true, () => void passouDoTeto(bytes, opts, tetoMs).then(resolver, rejeitar));
    }, tetoMs);
    t.w.on("message", aoMensagem);
    t.w.once("error", aoErro);
    t.w.once("exit", aoSair);
    // cópia dos bytes: quem chamou continua com o buffer dele (o hash, o cache)
    const copia = new Uint8Array(bytes);
    const { progresso: _p, sinal: _s, ...serializavel } = opts;
    const msg: MensagemAoTrabalhador = { t: "ler", id, bytes: copia, opcoes: { ...serializavel, limites }, parado: !!opts.sinal?.aborted };
    t.w.postMessage(msg, [copia.buffer]);
    // já parado vai junto com o "ler"; um "parar" antes dele a thread ignoraria, porque ainda não conhece a leitura
    if (!opts.sinal?.aborted) opts.sinal?.addEventListener("abort", aoParar, { once: true });
  });
}

/**
 * O `extrair` de sempre, numa thread com teto. Mesmo contrato: erro de
 * leitura vira `lido: false`, `LeituraInterrompidaError` sobe quando o sinal
 * pediu, e o teto estourado vira `lido: false` com o motivo.
 */
export async function extrairIsolado(bytes: Buffer | Uint8Array, opts: OpcoesIsoladas = {}): Promise<Extraido> {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { extrair, limitesDaConfig } = await import("./extrair");
  if (!isolar) return extrair(buf, opts);
  // os tetos são lidos AQUI e vão prontos: a thread não consulta o banco por eles, nem
  // por arquivo de dentro do ZIP. Ela ainda abre o pool dela (do @orbita/db, sob demanda)
  // quando o OCR, a visão ou a transcrição leem a config deles: o comentário de antes dizia
  // que a thread não precisava do banco, e não era verdade (M6)
  const [limites, teto, memoriaMb] = await Promise.all([limitesDaConfig(), settings.get("anexos.tetoDaLeituraSeg"), settings.get("anexos.memoriaDaLeituraMb")]);
  const todos: Limites = { ...limites, ...(opts.limites ?? {}) };
  return (await naThread(buf, opts, todos, teto * 1000, memoriaMb)) ?? extrair(buf, { ...opts, limites: todos });
}

/** Só para teste: liga a thread de verdade, troca o arquivo dela (um parser preso de propósito) e esvazia o pool. */
export async function _isolamentoEmTeste(ligado: boolean, arquivo?: URL): Promise<void> {
  isolar = ligado;
  arquivoDaThread = arquivo ?? new URL("./isolado-trabalhador.ts", import.meta.url);
  avisouQueNaoSobe = false;
  await Promise.all(livres.splice(0).map((t) => (clearTimeout(t.ociosa), t.w.terminate())));
}

