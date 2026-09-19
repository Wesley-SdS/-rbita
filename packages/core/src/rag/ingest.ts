import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { embedTexts } from "@orbita/llm";
import { db } from "@orbita/db";
import { document, chunk } from "@orbita/db/knowledge-schema";
import { chunkPaginas, juntarPaginas, type Trecho } from "./chunk";
import { settings } from "../settings";
import { limparCacheDeBusca } from "./retrieve";

export type Progresso = (feito: number, total: number | null, passo: string) => Promise<void>;

export interface IngestResultado {
  documentId: string | null;
  chunks: number;
  /** já existia com o mesmo conteúdo de arquivo: nada foi reindexado */
  duplicado?: boolean;
  paginas?: number;
}

/** SHA-256 do arquivo original. Mesmo arquivo, mesmo hash, um documento só. */
export function hashArquivo(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Indexa um documento que tem PÁGINAS (PDF lido página a página, imagem por
 * OCR, texto colado). Cada trecho guarda de qual página veio, para a resposta
 * citar "página 4" e a tela abrir o lugar exato.
 *
 * Documento e trechos entram na MESMA transação. Antes eram dois inserts
 * soltos: se o segundo falhasse, sobrava um documento vazio, e a retentativa
 * da fila criaria outro. Agora falhou é como se nunca tivesse começado, e
 * rodar de novo não duplica nada.
 */
export async function ingestPaginas(
  userId: string,
  title: string,
  paginas: string[],
  opcoes: { source?: string; fileHash?: string | null; progresso?: Progresso } = {},
): Promise<IngestResultado> {
  const { source = "text", fileHash = null, progresso } = opcoes;

  // dedup por arquivo: o mesmo documento enviado duas vezes não é indexado de
  // novo (e não some o antigo, que pode já ter sido citado numa conversa)
  if (fileHash) {
    const [existente] = await db
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.userId, userId), eq(document.fileHash, fileHash)))
      .limit(1);
    if (existente) return { documentId: existente.id, chunks: 0, duplicado: true, paginas: paginas.length };
  }

  // o texto guardado é EXATAMENTE o que o corte usou como origem: as posições
  // char_start/char_end de cada trecho só fazem sentido contra ele
  const { texto: textoCompleto, offsets } = juntarPaginas(paginas);
  const cfg = await settings.getMany(["rag.chunkTokens", "rag.chunkOverlapTokens"]);
  const trechos = chunkPaginas(paginas, {
    tokens: cfg["rag.chunkTokens"],
    overlap: Math.min(cfg["rag.chunkOverlapTokens"], cfg["rag.chunkTokens"] - 1),
  });
  if (!trechos.length) return { documentId: null, chunks: 0, paginas: paginas.length };

  await progresso?.(0, 2, `gerando embeddings de ${trechos.length} trecho${trechos.length === 1 ? "" : "s"}`);
  const embeddings = await embedTexts(trechos.map((t) => t.content));
  // consistência: um embedding por chunk (senão inseriríamos vetor undefined/corrompido)
  if (embeddings.length !== trechos.length) {
    throw new Error(`Embeddings inconsistentes: ${embeddings.length} para ${trechos.length} chunks`);
  }

  await progresso?.(1, 2, "guardando na memória");
  const documentId = await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(document)
      .values({ userId, title, source, fileHash, pages: paginas.length, content: textoCompleto, pageOffsets: offsets })
      .returning();
    if (!doc) throw new Error("Falha ao criar documento");
    await tx.insert(chunk).values(
      trechos.map((t: Trecho, i) => ({
        documentId: doc.id,
        userId,
        content: t.content,
        idx: i,
        embedding: embeddings[i]!,
        pageStart: t.pageStart,
        pageEnd: t.pageEnd,
        charStart: t.charStart,
        charEnd: t.charEnd,
      })),
    );
    return doc.id;
  });
  // conteúdo novo invalida busca cacheada: senão o documento recém-indexado
  // "não existe" pelos próximos segundos
  limparCacheDeBusca();
  return { documentId, chunks: trechos.length, paginas: paginas.length };
}

/** Texto sem páginas (colado na tela, transcrição de reunião). */
export async function ingestDocument(userId: string, title: string, content: string, source = "text", progresso?: Progresso) {
  return ingestPaginas(userId, title, [content], { source, progresso });
}
