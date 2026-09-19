import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { embedText } from "@orbita/llm";
import { db } from "@orbita/db";
import { chunk, document, memory } from "@orbita/db/knowledge-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { rerank } from "./rerank";

export interface RagHit {
  content: string;
  /** título do documento, ou "memória" */
  source: string;
  /** score final: similaridade quando é só vetor, score do RRF quando é híbrida */
  sim: number;
  documentId?: string;
  chunkId?: string;
  /** página no documento de origem (nulo em memória e em trecho antigo, sem reindexar) */
  pageStart?: number | null;
  pageEnd?: number | null;
  /** de onde o trecho veio, para diagnóstico e para a tela: vetor, texto ou os dois */
  via?: "vetor" | "texto" | "ambos";
}

// Cortes mínimos de similaridade e cache vêm da config (`rag.*`, tela de
// ajustes). Abaixo do corte o conteúdo é ruído — NÃO injetamos no contexto
// (evita alucinação por RAG).
//
// Cache de resultado de busca: evita re-embedar + re-consultar a MESMA query em
// janela curta (pré-injeção + tool no mesmo turno, retries e failover, ou o
// usuário reenviando). Chave por (usuário, k, query normalizada).
const searchCache = new Map<string, { at: number; hits: RagHit[] }>();
const cacheKey = (userId: string, query: string, k: number) => `${userId}:${k}:${query.trim().toLowerCase()}`;
function cacheGet(key: string, ttlMs: number): RagHit[] | null {
  const e = searchCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > ttlMs) { searchCache.delete(key); return null; }
  return e.hits;
}
function cacheSet(key: string, hits: RagHit[], max: number) {
  if (max <= 0) return;
  while (searchCache.size >= max) { const oldest = searchCache.keys().next().value; if (oldest) searchCache.delete(oldest); else break; }
  searchCache.set(key, { at: Date.now(), hits });
}

/** Zera o cache (troca de provedor de embedding, reindexação). */
export function limparCacheDeBusca(): void {
  searchCache.clear();
}

interface Candidato extends RagHit {
  chave: string;
}

/**
 * RECIPROCAL RANK FUSION (Cormack, Clarke e Büttcher, SIGIR 2009).
 *
 * Cada lista contribui `peso / (k + posição)`. Soma-se por documento. É o jeito
 * de fundir listas cujos scores não são comparáveis entre si: a similaridade de
 * cosseno (0 a 1) e o `ts_rank_cd` do Postgres (sem escala fixa) não se somam,
 * mas as POSIÇÕES se fundem. O `k` amortece o peso dos primeiros lugares de uma
 * lista que esteja sozinha e errada; o paper fixou 60 num piloto e mostrou que
 * a escolha não é crítica (MAP 0,2123 em k=10 contra 0,2144 em k=60).
 *
 * Puro de propósito: é a peça que mais merece teste.
 */
export function fundirRRF(listas: { itens: Candidato[]; peso: number }[], k: number, limite: number): Candidato[] {
  const acumulado = new Map<string, { item: Candidato; score: number; vias: Set<string> }>();
  for (const { itens, peso } of listas) {
    itens.forEach((item, posicao) => {
      const atual = acumulado.get(item.chave);
      if (atual) {
        atual.score += peso / (k + posicao + 1);
        if (item.via) atual.vias.add(item.via);
      } else {
        acumulado.set(item.chave, { item, score: peso / (k + posicao + 1), vias: new Set(item.via ? [item.via] : []) });
      }
    });
  }
  return [...acumulado.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
    .map((e) => ({ ...e.item, sim: e.score, via: e.vias.size > 1 ? ("ambos" as const) : (e.item.via ?? "vetor") }));
}

const CHAVE_MEMORIA = (id: string) => `m:${id}`;
const CHAVE_TRECHO = (id: string) => `c:${id}`;

async function vetorEmTrechos(userId: string, q: number[], minSim: number, limite: number): Promise<Candidato[]> {
  const sim = sql<number>`1 - (${cosineDistance(chunk.embedding, q)})`;
  const linhas = await db
    .select({ id: chunk.id, content: chunk.content, title: document.title, documentId: document.id, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, sim })
    .from(chunk)
    .innerJoin(document, eq(chunk.documentId, document.id))
    .where(and(eq(chunk.userId, userId), gt(sim, minSim)))
    .orderBy(desc(sim))
    .limit(limite);
  return linhas.map((l) => ({
    chave: CHAVE_TRECHO(l.id),
    chunkId: l.id,
    documentId: l.documentId,
    content: l.content,
    source: l.title,
    pageStart: l.pageStart,
    pageEnd: l.pageEnd,
    sim: Number(l.sim),
    via: "vetor" as const,
  }));
}

/**
 * A pergunta do dono vira consulta textual. Duas formas, e a diferença é
 * enorme: medido com os documentos dele (bench/MEDICAO-RAG-OCR.md), exigir
 * TODOS os termos (`websearch_to_tsquery`, o do exemplo oficial do pgvector)
 * acertou 6,7% das perguntas, e unir os MESMOS termos por "|" acertou 56,7%.
 * Pergunta em linguagem natural quase nunca tem um trecho com todas as
 * palavras; quem separa o joio é o `ts_rank_cd`, que premia quantidade e
 * proximidade dos termos achados.
 *
 * `to_tsvector` sobre a pergunta já normaliza e tira as palavras vazias, e
 * nunca levanta erro de sintaxe com entrada crua (aspas, hífen, "or").
 */
function tsqueryDaPergunta(consulta: string, modo: string) {
  return modo === "and"
    ? sql`websearch_to_tsquery('public.portuguese_unaccent', ${consulta})`
    : sql`array_to_string(tsvector_to_array(to_tsvector('public.portuguese_unaccent', ${consulta})), ' | ')::tsquery`;
}

async function textoEmTrechos(userId: string, consulta: string, minRank: number, limite: number, modo: string): Promise<Candidato[]> {
  const q = tsqueryDaPergunta(consulta, modo);
  const linhas = await db.execute<{ id: string; content: string; title: string; document_id: string; page_start: number | null; page_end: number | null; rank: number }>(sql`
    WITH consulta AS (SELECT ${q} AS q)
    SELECT c.id, c.content, d.title, d.id AS document_id, c.page_start, c.page_end,
           ts_rank_cd(c.fts, consulta.q) AS rank
      FROM ${chunk} c
      JOIN ${document} d ON d.id = c.document_id,
           consulta
     WHERE c.user_id = ${userId} AND consulta.q IS NOT NULL
       AND c.fts @@ consulta.q AND ts_rank_cd(c.fts, consulta.q) > ${minRank}
     ORDER BY rank DESC
     LIMIT ${limite}`);
  return [...linhas].map((l) => ({
    chave: CHAVE_TRECHO(l.id),
    chunkId: l.id,
    documentId: l.document_id,
    content: l.content,
    source: l.title,
    pageStart: l.page_start,
    pageEnd: l.page_end,
    sim: Number(l.rank),
    via: "texto" as const,
  }));
}

async function vetorEmMemoria(userId: string, q: number[], minSim: number, limite: number): Promise<Candidato[]> {
  const sim = sql<number>`1 - (${cosineDistance(memory.embedding, q)})`;
  const linhas = await db
    .select({ id: memory.id, content: memory.content, sim })
    .from(memory)
    .where(and(eq(memory.userId, userId), gt(sim, minSim)))
    .orderBy(desc(sim))
    .limit(limite);
  return linhas.map((l) => ({ chave: CHAVE_MEMORIA(l.id), content: l.content, source: "memória", sim: Number(l.sim), via: "vetor" as const }));
}

async function textoEmMemoria(userId: string, consulta: string, minRank: number, limite: number, modo: string): Promise<Candidato[]> {
  const q = tsqueryDaPergunta(consulta, modo);
  const linhas = await db.execute<{ id: string; content: string; rank: number }>(sql`
    WITH consulta AS (SELECT ${q} AS q)
    SELECT m.id, m.content, ts_rank_cd(m.fts, consulta.q) AS rank
      FROM ${memory} m, consulta
     WHERE m.user_id = ${userId} AND consulta.q IS NOT NULL
       AND m.fts @@ consulta.q AND ts_rank_cd(m.fts, consulta.q) > ${minRank}
     ORDER BY rank DESC
     LIMIT ${limite}`);
  return [...linhas].map((l) => ({ chave: CHAVE_MEMORIA(l.id), content: l.content, source: "memória", sim: Number(l.rank), via: "texto" as const }));
}

/**
 * Busca no conhecimento do usuário (documentos + memória).
 *
 * Híbrida por padrão: o lado VETORIAL acha o que foi dito com outras palavras
 * ("quanto entrou de rescisão" achando "REMUNERACAO/SALARIO rescisao_contra"),
 * o lado TEXTUAL acha número, nome próprio e código, que o embedding costuma
 * borrar ("0800 011 0197", "unidade 71"). As duas listas são fundidas por RRF e,
 * quando a reordenação está ligada, um modelo de reordenação decide a ordem
 * final entre os candidatos.
 *
 * Fail-soft por lado: se a busca textual falhar (por exemplo num banco antigo,
 * sem a coluna `fts`), a vetorial responde sozinha. O contrário também vale.
 */
export async function retrieveContext(userId: string, query: string, k = 4): Promise<RagHit[]> {
  const cfg = await settings.getMany([
    "rag.chunkMinSim", "rag.memoryMinSim", "rag.cacheTtlMs", "rag.cacheMax",
    "rag.hybrid", "rag.rrfK", "rag.weightVector", "rag.weightText", "rag.textMinRank", "rag.candidates", "rag.textMode",
  ]);
  const key = cacheKey(userId, query, k);
  const cached = cacheGet(key, cfg["rag.cacheTtlMs"]);
  if (cached) return cached;

  const candidatos = Math.max(k, cfg["rag.candidates"]);
  const q = await embedText(query, "query");

  const vazio = (motivo: string) => (e: unknown) => {
    log.error("rag.busca", { lado: motivo, error: e instanceof Error ? e.message : String(e) });
    return [] as Candidato[];
  };

  const [chunksVetor, memVetor, chunksTexto, memTexto] = await Promise.all([
    vetorEmTrechos(userId, q, cfg["rag.chunkMinSim"], candidatos).catch(vazio("vetor.trechos")),
    vetorEmMemoria(userId, q, cfg["rag.memoryMinSim"], Math.max(k, Math.ceil(candidatos / 2))).catch(vazio("vetor.memoria")),
    cfg["rag.hybrid"] ? textoEmTrechos(userId, query, cfg["rag.textMinRank"], candidatos, cfg["rag.textMode"]).catch(vazio("texto.trechos")) : Promise.resolve([] as Candidato[]),
    cfg["rag.hybrid"] ? textoEmMemoria(userId, query, cfg["rag.textMinRank"], Math.max(k, Math.ceil(candidatos / 2)), cfg["rag.textMode"]).catch(vazio("texto.memoria")) : Promise.resolve([] as Candidato[]),
  ]);

  let hits: RagHit[];
  if (!cfg["rag.hybrid"]) {
    // só vetor: memória e trechos competem pela similaridade, como antes
    hits = [...memVetor, ...chunksVetor].sort((a, b) => b.sim - a.sim).slice(0, k);
  } else {
    const fundidos = fundirRRF(
      [
        { itens: [...chunksVetor, ...memVetor].sort((a, b) => b.sim - a.sim), peso: cfg["rag.weightVector"] },
        { itens: [...chunksTexto, ...memTexto].sort((a, b) => b.sim - a.sim), peso: cfg["rag.weightText"] },
      ],
      cfg["rag.rrfK"],
      candidatos,
    );
    hits = await rerank(query, fundidos, k);
  }

  const limpos = hits.map(({ ...h }) => h);
  cacheSet(key, limpos, cfg["rag.cacheMax"]);
  return limpos;
}
