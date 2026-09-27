/**
 * Modelo de embedding LOCAL (Ollama). O padrão é multilíngue de propósito: o
 * `nomic-embed-text` v1, que era o default, é descrito pelo próprio autor como
 * modelo SÓ DE INGLÊS, e o acervo desta casa é em português. Medido com os
 * documentos do dono (bench/MEDICAO-RAG-OCR.md), a troca levou o acerto da
 * busca vetorial de 50,0% para 76,7%.
 *
 * O valor efetivo vem da config (`embeddings.localModel`, na tela de Ajustes);
 * isto é só o default, e a variável de ambiente continua valendo como
 * bootstrap. Trocar o modelo INVALIDA os vetores gravados: precisa reindexar.
 */
export const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text-v2-moe";
export const EMBED_DIMS = 768;

/**
 * O nomic-embed-text foi treinado com prefixos de tarefa e depende deles para o
 * recall assimétrico query↔documento. Sem os prefixos, a busca perde qualidade.
 * `query` = texto de busca; `document` = conteúdo indexado.
 * ATENÇÃO: os prefixos são específicos do nomic (local); modelos de nuvem não os usam.
 */
export type EmbedKind = "query" | "document";
/** O modelo local em uso, resolvido por chamada (a config pode mudar sem restart). */
type ModelSource = string | (() => Promise<string> | string);
let localModel: ModelSource = EMBED_MODEL;
async function resolveLocalModel(): Promise<string> {
  try {
    const m = typeof localModel === "function" ? await localModel() : localModel;
    return m?.trim() || EMBED_MODEL;
  } catch {
    return EMBED_MODEL;
  }
}
/** Modelos da família nomic dependem de prefixo de tarefa; os outros, não. */
export function usaPrefixoDeTarefa(modelo: string): boolean {
  return /nomic/i.test(modelo);
}
const PREFIX: Record<EmbedKind, string> = {
  query: "search_query: ",
  document: "search_document: ",
};

// Base nativa do ollama (sem /v1) — a API nativa aceita `keep_alive`, que o
// endpoint OpenAI-compat não expõe.
const OLLAMA = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/v1\/?$/, "");
// Mantém o modelo de embedding RESIDENTE — sem isso o ollama descarrega o nomic
// entre turnos e o próximo embedding paga um cold-start de ~20s (sem GPU).
const KEEP_ALIVE = process.env.OLLAMA_EMBED_KEEP_ALIVE || "60m";

/**
 * Embedding de NUVEM, para deploys sem Ollama (ex.: Vercel). Usa a API
 * OpenAI-compatible de embeddings. Os modelos entregam mais dimensões do que a
 * coluna do banco (768), então SEMPRE pedimos `dimensions: 768`:
 *   - Gemini `gemini-embedding-2` (padrão): GA, grátis no free tier, #1 no MTEB,
 *     8192 tokens de contexto e — importante — NORMALIZA sozinho ao truncar.
 *     O `gemini-embedding-001` exigiria normalização MANUAL abaixo de 3072.
 *   - OpenAI `text-embedding-3-small`: 1536 por padrão, reduzível para 768.
 *
 * ⚠️ Trocar de provedor de embedding INVALIDA os vetores já gravados: modelos
 * diferentes vivem em espaços vetoriais distintos, e a similaridade entre eles
 * não significa nada. Ao migrar um corpus existente, é preciso REINDEXAR.
 */
// `gemini` e `openai` existem porque "nuvem" sozinho escondia uma surpresa: a
// ASSINATURA do Claude não serve para embedding (a Anthropic não tem endpoint
// de embeddings). Na casa que pôs tudo na assinatura, o embedding de nuvem é
// sempre de OUTRO provedor, e o dono precisa poder dizer qual.
export type EmbedPreference = "auto" | "local" | "cloud" | "gemini" | "openai";
// Preferência vem da config (`embeddings.provider`); "auto" mantém o comportamento
// antigo (nuvem se houver chave). "local" é o caminho de privacidade: nada sai de casa.
// A preferência é um GETTER (assíncrono) avaliado a cada embed, não um valor
// fixado por outra requisição: assim "Sempre local" vale também para reindexar,
// ingest, memória e skills, e vale logo depois de um restart.
type PreferenceSource = EmbedPreference | (() => Promise<EmbedPreference> | EmbedPreference);
let preference: PreferenceSource = "auto";

/**
 * Quem contabiliza o consumo de embedding.
 *
 * É um gancho e não uma chamada direta porque `packages/llm` não pode importar
 * `packages/core` (a dependência é no sentido contrário). O core injeta isto
 * no boot; sem injeção, o módulo funciona igual e só não aparece na conta.
 */
export type RelatoDeEmbedding = (info: {
  provider: "cloud" | "local";
  modelo: string;
  itens: number;
  caracteres: number;
  duracaoMs: number;
  userId?: string;
  fluxo?: string;
}) => void;
let relatarEmbedding: RelatoDeEmbedding | null = null;

export function configureEmbeddings(p: { provider?: PreferenceSource; localModel?: ModelSource; aoUsar?: RelatoDeEmbedding }): void {
  if (p.provider) preference = p.provider;
  if (p.localModel) localModel = p.localModel;
  if (p.aoUsar) relatarEmbedding = p.aoUsar;
}

/** De quem é a conta desta chamada de embedding. Opcional: sem isto, ela não é atribuída. */
export interface ContextoDeEmbedding {
  userId?: string;
  fluxo?: string;
}
async function resolvePreference(): Promise<EmbedPreference> {
  try {
    return typeof preference === "function" ? await preference() : preference;
  } catch {
    return "auto";
  }
}

type Env = Record<string, string | undefined>;
interface CloudConfig { provedor: "google" | "openai"; baseURL: string; apiKey: string; model: string; dimensions?: number }

function gemini(env: Env): CloudConfig | null {
  const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  return {
    provedor: "google",
    baseURL: env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey,
    model: env.EMBED_MODEL_CLOUD ?? "gemini-embedding-2",
    dimensions: EMBED_DIMS, // 3072 por padrão; truncamos p/ bater com a coluna
  };
}

function openai(env: Env): CloudConfig | null {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    provedor: "openai",
    baseURL: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
    model: env.EMBED_MODEL_CLOUD ?? "text-embedding-3-small",
    dimensions: EMBED_DIMS,
  };
}

/** A nuvem que atende esta preferência, ou nulo (local, ou sem chave). Puro. */
function cloudConfig(pref: EmbedPreference, env: Env = process.env): CloudConfig | null {
  if (pref === "local") return null;
  if (pref === "gemini") return gemini(env);
  if (pref === "openai") return openai(env);
  return gemini(env) ?? openai(env);
}

/**
 * Onde e com qual modelo o embedding roda. Puro, para teste.
 *
 * A `chave` (`google/gemini-embedding-2`, `local/nomic-embed-text-v2-moe`) é
 * gravada ao lado de cada vetor (`embed_model`): vetores de modelos diferentes
 * vivem em espaços diferentes, e sem saber quem gerou cada um a busca
 * compararia os dois em silêncio (E2 do PRD-SEM-OLLAMA).
 */
export function resolverEmbedding(
  pref: EmbedPreference,
  localModel: string,
  env: Env = process.env,
): { onde: "cloud"; chave: string; cfg: CloudConfig } | { onde: "local"; chave: string; modelo: string } {
  const cfg = cloudConfig(pref, env);
  if (cfg) return { onde: "cloud", chave: `${cfg.provedor}/${cfg.model}`, cfg };
  if (pref !== "auto" && pref !== "local") {
    const qual = pref === "gemini" ? "GEMINI_API_KEY" : pref === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY ou OPENAI_API_KEY";
    // a assinatura do Claude não entra aqui de propósito: não existe embedding nela
    throw new Error(`Embedding configurado para a nuvem, mas falta ${qual}. A assinatura do Claude não gera embeddings.`);
  }
  return { onde: "local", chave: `local/${localModel}`, modelo: localModel };
}

/** Qual caminho de embedding o automático usaria (diagnóstico / health): só olha as chaves. */
export function embedProvider(): "cloud" | "local" {
  return cloudConfig("auto") ? "cloud" : "local";
}

/** Chave do modelo de embedding ativo agora (a que vai para `embed_model`). Lança se a config pede nuvem sem chave. */
export async function modeloDeEmbedding(): Promise<string> {
  return resolverEmbedding(await resolvePreference(), await resolveLocalModel()).chave;
}

// Cache LRU em memória: query/doc idênticos = 0 chamadas ao modelo. A chave
// leva o MODELO: sem ele, trocar de provedor devolvia do cache o vetor do
// modelo antigo, e a busca comparava espaços diferentes justo depois da troca.
const cache = new Map<string, number[]>();
const CACHE_MAX = 1000;
function cacheGet(k: string): number[] | undefined {
  const v = cache.get(k);
  if (v) { cache.delete(k); cache.set(k, v); } // "toca" p/ LRU
  return v;
}
function cacheSet(k: string, v: number[]) {
  cache.set(k, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

async function ollamaEmbed(inputs: string[], modelo: string): Promise<number[][]> {
  const r = await fetch(OLLAMA + "/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelo, input: inputs, keep_alive: KEEP_ALIVE }),
  });
  if (!r.ok) throw new Error(`embed_failed:${r.status}`);
  const j = (await r.json()) as { embeddings?: number[][] };
  if (!j.embeddings?.length) throw new Error("embed_empty");
  return j.embeddings;
}

async function cloudEmbed(inputs: string[], cfg: CloudConfig): Promise<number[][]> {
  const url = cfg.baseURL.replace(/\/+$/, "") + "/embeddings";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      input: inputs,
      ...(cfg.dimensions ? { dimensions: cfg.dimensions } : {}),
    }),
  });
  if (!r.ok) throw new Error(`embed_cloud_failed:${r.status}:${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { data?: { embedding: number[]; index: number }[] };
  if (!j.data?.length) throw new Error("embed_cloud_empty");
  return [...j.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

type Rota = ReturnType<typeof resolverEmbedding>;

async function rotaAtual(): Promise<Rota> {
  return resolverEmbedding(await resolvePreference(), await resolveLocalModel());
}

/** Roteia conforme a preferência: local (Ollama), uma nuvem específica, ou auto. */
async function embed(inputs: string[], kind: EmbedKind, rota: Rota, ctx?: ContextoDeEmbedding): Promise<number[][]> {
  const comecou = Date.now();
  const caracteres = inputs.reduce((n, t) => n + t.length, 0);
  if (rota.onde === "cloud") {
    const r = await cloudEmbed(inputs, rota.cfg); // nuvem: sem prefixo de tarefa
    relatarEmbedding?.({ provider: "cloud", modelo: rota.cfg.model, itens: inputs.length, caracteres, duracaoMs: Date.now() - comecou, ...ctx });
    return r;
  }
  // só a família nomic usa prefixo de tarefa; mandar "search_query: " para um
  // modelo que não o espera é texto lixo dentro da consulta
  const r = await ollamaEmbed(usaPrefixoDeTarefa(rota.modelo) ? inputs.map((v) => PREFIX[kind] + v) : inputs, rota.modelo);
  relatarEmbedding?.({ provider: "local", modelo: rota.modelo, itens: inputs.length, caracteres, duracaoMs: Date.now() - comecou, ...ctx });
  return r;
}

/**
 * Vetor E o modelo que o gerou. Quem grava vetor usa esta forma e grava o
 * modelo junto; quem compara filtra pelo modelo do vetor da pergunta.
 */
export async function embedTextComModelo(value: string, kind: EmbedKind = "query", ctx?: ContextoDeEmbedding): Promise<{ vetor: number[]; modelo: string }> {
  const rota = await rotaAtual();
  const key = `${rota.chave}:${kind}:${value}`;
  const hit = cacheGet(key);
  if (hit) return { vetor: hit, modelo: rota.chave }; // acerto de cache não custa nada e por isso não entra na conta
  const [emb] = await embed([value], kind, rota, ctx);
  cacheSet(key, emb!);
  return { vetor: emb!, modelo: rota.chave };
}

export async function embedTextsComModelo(values: string[], kind: EmbedKind = "document", ctx?: ContextoDeEmbedding): Promise<{ vetores: number[][]; modelo: string }> {
  // lista vazia não chama ninguém, então não pode falhar por config
  if (!values.length) return { vetores: [], modelo: (await rotaAtual().catch(() => null))?.chave ?? "" };
  const rota = await rotaAtual();
  return { vetores: await embed(values, kind, rota, ctx), modelo: rota.chave };
}

export async function embedText(value: string, kind: EmbedKind = "query", ctx?: ContextoDeEmbedding): Promise<number[]> {
  return (await embedTextComModelo(value, kind, ctx)).vetor;
}

export async function embedTexts(values: string[], kind: EmbedKind = "document", ctx?: ContextoDeEmbedding): Promise<number[][]> {
  return (await embedTextsComModelo(values, kind, ctx)).vetores;
}

/** Aquece o modelo de embedding (chamar no boot evita o cold-start no 1º uso).
 *  Só faz sentido no local: na nuvem não há cold-start de modelo residente. */
export async function warmupEmbedding(): Promise<void> {
  if (embedProvider() === "cloud") return;
  try { await embedText("warmup", "query"); } catch { /* best-effort */ }
}
