import { eq, sql } from "drizzle-orm";
import { embedTexts } from "@orbita/llm";
import { db } from "@orbita/db";
import { chunk, document, memory } from "@orbita/db/knowledge-schema";
import { chunkPaginas, separarPaginas } from "./chunk";
import { settings } from "../settings";
import { limparCacheDeBusca } from "./retrieve";
import { log } from "../observability/logger";
import type { Progresso } from "./ingest";

/**
 * REINDEXAR O ACERVO INTEIRO (R2).
 *
 * Duas coisas diferentes, e a diferença importa:
 *
 *  - `recalcular`: mantém os cortes e refaz só os vetores. É o que se precisa
 *    ao TROCAR O MODELO DE EMBEDDING (vetor de modelo diferente não é
 *    comparável com o antigo: a similaridade entre eles não quer dizer nada).
 *
 *  - `recortar`: corta o documento de novo, do zero, e reembeda. É o que se
 *    precisa ao mudar o tamanho do trecho, ou para dar PÁGINA aos documentos
 *    antigos, indexados quando o corte ainda não sabia de onde o trecho vinha.
 *    Só funciona em documento que guardou o texto de origem (`document.content`);
 *    os antigos caem para `recalcular`, que é o melhor possível sem o original.
 *
 * Roda como trabalho de fila porque é lento por natureza: é uma chamada de
 * embedding por lote, para o acervo todo.
 */

export type ModoReindex = "recalcular" | "recortar";

export interface ResultadoReindex {
  documentos: number;
  trechos: number;
  memorias: number;
  recortados: number;
  semTextoOriginal: number;
}

const LOTE = 32;

async function reembedar<T extends { id: string; content: string }>(
  linhas: T[],
  atualizar: (id: string, emb: number[]) => Promise<unknown>,
): Promise<number> {
  let feitos = 0;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    const vetores = await embedTexts(lote.map((l) => l.content), "document");
    if (vetores.length !== lote.length) throw new Error(`Embeddings inconsistentes: ${vetores.length} para ${lote.length}`);
    await Promise.all(lote.map((l, j) => atualizar(l.id, vetores[j]!)));
    feitos += lote.length;
  }
  return feitos;
}

export async function reindexarTudo(userId: string, modo: ModoReindex = "recortar", progresso?: Progresso): Promise<ResultadoReindex> {
  const cfg = await settings.getMany(["rag.chunkTokens", "rag.chunkOverlapTokens"]);
  const docs = await db
    .select({ id: document.id, title: document.title, content: document.content, pageOffsets: document.pageOffsets })
    .from(document)
    .where(eq(document.userId, userId));
  const mems = await db.select({ id: memory.id, content: memory.content }).from(memory).where(eq(memory.userId, userId));

  const total = docs.length + 1;
  const resultado: ResultadoReindex = { documentos: docs.length, trechos: 0, memorias: 0, recortados: 0, semTextoOriginal: 0 };

  for (const [i, doc] of docs.entries()) {
    await progresso?.(i, total, `reindexando "${doc.title}" (${i + 1} de ${docs.length})`);

    const podeRecortar = modo === "recortar" && Boolean(doc.content?.trim());
    if (!podeRecortar) {
      if (modo === "recortar") resultado.semTextoOriginal++;
      const trechos = await db.select({ id: chunk.id, content: chunk.content }).from(chunk).where(eq(chunk.documentId, doc.id));
      resultado.trechos += await reembedar(trechos, (id, emb) => db.update(chunk).set({ embedding: emb }).where(eq(chunk.id, id)));
      continue;
    }

    // recorte novo: as páginas voltam a existir pelas posições guardadas
    const paginas = separarPaginas(doc.content!, doc.pageOffsets ?? []);
    const novos = chunkPaginas(paginas, {
      tokens: cfg["rag.chunkTokens"],
      overlap: Math.min(cfg["rag.chunkOverlapTokens"], cfg["rag.chunkTokens"] - 1),
    });
    if (!novos.length) continue;
    const vetores: number[][] = [];
    for (let j = 0; j < novos.length; j += LOTE) {
      const lote = novos.slice(j, j + LOTE);
      const parte = await embedTexts(lote.map((t) => t.content), "document");
      if (parte.length !== lote.length) throw new Error(`Embeddings inconsistentes: ${parte.length} para ${lote.length}`);
      vetores.push(...parte);
    }

    // troca atômica: o documento nunca fica sem trechos (uma busca no meio do
    // caminho devolveria vazio e o turno perderia o contexto)
    await db.transaction(async (tx) => {
      await tx.delete(chunk).where(eq(chunk.documentId, doc.id));
      await tx.insert(chunk).values(
        novos.map((t, idx) => ({
          documentId: doc.id,
          userId,
          content: t.content,
          idx,
          embedding: vetores[idx]!,
          pageStart: t.pageStart,
          pageEnd: t.pageEnd,
          charStart: t.charStart,
          charEnd: t.charEnd,
        })),
      );
    });
    resultado.trechos += novos.length;
    resultado.recortados++;
  }

  await progresso?.(docs.length, total, "reindexando a memória");
  resultado.memorias = await reembedar(mems, (id, emb) => db.update(memory).set({ embedding: emb }).where(eq(memory.id, id)));

  limparCacheDeBusca();
  log.info("rag.reindex", { userId, modo, ...resultado });
  return resultado;
}

/** Quanto há para reindexar (a tela mostra antes de o dono mandar). */
export async function tamanhoDoAcervo(userId: string): Promise<{ documentos: number; trechos: number; memorias: number; semPagina: number }> {
  const [linha] = await db.execute<{ documentos: number; trechos: number; memorias: number; sem_pagina: number }>(sql`
    SELECT
      (SELECT count(*) FROM ${document} WHERE user_id = ${userId})::int AS documentos,
      (SELECT count(*) FROM ${chunk} WHERE user_id = ${userId})::int AS trechos,
      (SELECT count(*) FROM ${memory} WHERE user_id = ${userId})::int AS memorias,
      (SELECT count(*) FROM ${chunk} WHERE user_id = ${userId} AND page_start IS NULL)::int AS sem_pagina`);
  return {
    documentos: Number(linha?.documentos ?? 0),
    trechos: Number(linha?.trechos ?? 0),
    memorias: Number(linha?.memorias ?? 0),
    semPagina: Number(linha?.sem_pagina ?? 0),
  };
}

