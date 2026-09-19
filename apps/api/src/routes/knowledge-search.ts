// Busca no acervo pela tela (R2) e abertura do trecho citado.
//
// A mesma busca que o chat usa, exposta para o dono conferir com os próprios
// olhos: cada resultado diz de qual documento e de qual página veio, e o trecho
// pode ser aberto no contexto em volta, no texto original.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { chunk, document } from "@orbita/db/knowledge-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { retrieveContext } from "@orbita/core/rag/retrieve";
import { settings } from "@orbita/core/settings/index";
import { rateLimit, tooMany } from "@orbita/core/ratelimit";

const Consulta = z.object({
  q: z.string().min(1).max(500),
  k: z.coerce.number().int().min(1).max(20).optional(),
});

export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const userId = session.user.id;
  const url = new URL(req.url);

  // abrir um trecho: devolve o texto em volta, no documento de origem
  const trechoId = url.searchParams.get("trecho");
  if (trechoId) {
    if (!z.string().uuid().safeParse(trechoId).success) return Response.json({ error: "trecho inválido" }, { status: 400 });
    const [linha] = await db
      .select({
        id: chunk.id,
        conteudo: chunk.content,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        titulo: document.title,
        documentId: document.id,
        texto: document.content,
        paginas: document.pages,
      })
      .from(chunk)
      .innerJoin(document, eq(chunk.documentId, document.id))
      .where(and(eq(chunk.id, trechoId), eq(chunk.userId, userId)))
      .limit(1);
    if (!linha) return Response.json({ error: "Trecho não encontrado" }, { status: 404 });

    const janela = await settings.get("rag.excerptContextChars");
    const texto = linha.texto ?? "";
    // documento antigo (indexado antes de guardarmos o original) não tem
    // contexto em volta: devolvemos o próprio trecho, sem inventar
    const temOrigem = Boolean(texto) && linha.charStart != null && linha.charEnd != null;
    const ini = temOrigem ? Math.max(0, linha.charStart! - janela) : 0;
    const fim = temOrigem ? Math.min(texto.length, linha.charEnd! + janela) : 0;
    return Response.json({
      documentId: linha.documentId,
      titulo: linha.titulo,
      paginaInicio: linha.pageStart,
      paginaFim: linha.pageEnd,
      paginas: linha.paginas,
      trecho: linha.conteudo,
      contexto: temOrigem ? texto.slice(ini, fim) : linha.conteudo,
      antes: temOrigem ? linha.charStart! - ini : 0,
      depois: temOrigem ? fim - linha.charEnd! : 0,
    });
  }

  const parsed = Consulta.safeParse({ q: url.searchParams.get("q") ?? "", k: url.searchParams.get("k") ?? undefined });
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const rl = rateLimit(`busca:${userId}`, await settings.get("limits.searchPerMinute"), 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const k = parsed.data.k ?? (await settings.get("rag.topK"));
  const hits = await retrieveContext(userId, parsed.data.q, k);
  return Response.json({
    resultados: hits.map((h) => ({
      trechoId: h.chunkId ?? null,
      documentId: h.documentId ?? null,
      fonte: h.source,
      paginaInicio: h.pageStart ?? null,
      paginaFim: h.pageEnd ?? null,
      via: h.via ?? null,
      score: Number(h.sim.toFixed(4)),
      trecho: h.content.length > 600 ? h.content.slice(0, 600) + "…" : h.content,
    })),
  });
}
