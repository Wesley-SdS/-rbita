// Migrada do Next em paridade (apps/web/src/app/api/knowledge/route.ts).
import { count, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { document, chunk, memory } from "@orbita/db/knowledge-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const userId = session.user.id;

  const [docs] = await db.select({ n: count() }).from(document).where(eq(document.userId, userId));
  const [chunks] = await db.select({ n: count() }).from(chunk).where(eq(chunk.userId, userId));
  const [mems] = await db.select({ n: count() }).from(memory).where(eq(memory.userId, userId));

  return Response.json({
    documents: docs?.n ?? 0,
    chunks: chunks?.n ?? 0,
    memories: mems?.n ?? 0,
  });
}
