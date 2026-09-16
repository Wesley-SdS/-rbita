// Migrada do Next em paridade (apps/web/src/app/api/memory/route.ts).
import { z } from "zod";
import { and, desc, eq, gt, sql, cosineDistance } from "drizzle-orm";
import { embedText } from "@orbita/llm";
import { db } from "@orbita/db";
import { memory } from "@orbita/db/knowledge-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { settings } from "@orbita/core/settings/index";

const Body = z.object({ content: z.string().min(1).max(2000) });

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select({ id: memory.id, content: memory.content, createdAt: memory.createdAt })
    .from(memory)
    .where(eq(memory.userId, session.user.id))
    .orderBy(desc(memory.createdAt))
    .limit(50);
  return Response.json({ memories: rows });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const embedding = await embedText(parsed.data.content, "document");
  // dedup: não grava memória quase idêntica a uma existente (limiar configurável pela tela)
  const dedupSim = await settings.get("memory.dedupSim");
  const sim = sql<number>`1 - (${cosineDistance(memory.embedding, embedding)})`;
  const [dup] = await db
    .select({ id: memory.id, sim })
    .from(memory)
    .where(and(eq(memory.userId, session.user.id), gt(sim, dedupSim)))
    .orderBy(desc(sim))
    .limit(1);
  if (dup) return Response.json({ id: dup.id, deduped: true });

  const [row] = await db
    .insert(memory)
    .values({ userId: session.user.id, content: parsed.data.content, embedding })
    .returning({ id: memory.id });
  return Response.json({ id: row?.id });
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(memory).where(and(eq(memory.id, id), eq(memory.userId, session.user.id)));
  return Response.json({ ok: true });
}
