// Migrada do Next em paridade (apps/web/src/app/api/knowledge/route.ts).
import { count, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { document, chunk, memory } from "@orbita/db/knowledge-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { leituraCacheavel } from "../http/cacheable";

export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const userId = session.user.id;

  // Em PARALELO e não em série: são três contagens independentes, e a Visão
  // geral espera esta rota para escrever um número na tela. Em série eram três
  // idas ao banco somadas; agora é a mais lenta das três.
  const [[docs], [chunks], [mems]] = await Promise.all([
    db.select({ n: count() }).from(document).where(eq(document.userId, userId)),
    db.select({ n: count() }).from(chunk).where(eq(chunk.userId, userId)),
    db.select({ n: count() }).from(memory).where(eq(memory.userId, userId)),
  ]);

  return leituraCacheavel(req, {
    documents: docs?.n ?? 0,
    chunks: chunks?.n ?? 0,
    memories: mems?.n ?? 0,
  });
}
