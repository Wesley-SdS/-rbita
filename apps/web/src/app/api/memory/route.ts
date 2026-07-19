import { z } from "zod";
import { and, desc, eq, gt, sql, cosineDistance } from "drizzle-orm";
import { embedText } from "@orbita/llm";
import { db } from "@/lib/db";
import { memory } from "@/lib/db/knowledge-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ content: z.string().min(1).max(2000) });

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select({ id: memory.id, content: memory.content, createdAt: memory.createdAt })
    .from(memory)
    .where(eq(memory.userId, session.user.id))
    .orderBy(desc(memory.createdAt))
    .limit(50);
  return Response.json({ memories: rows });
}

export async function POST(req: Request) {
  const session = await getSession();
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
  // dedup: não grava memória quase idêntica a uma existente
  const sim = sql<number>`1 - (${cosineDistance(memory.embedding, embedding)})`;
  const [dup] = await db
    .select({ id: memory.id, sim })
    .from(memory)
    .where(and(eq(memory.userId, session.user.id), gt(sim, 0.92)))
    .orderBy(desc(sim))
    .limit(1);
  if (dup) return Response.json({ id: dup.id, deduped: true });

  const [row] = await db
    .insert(memory)
    .values({ userId: session.user.id, content: parsed.data.content, embedding })
    .returning({ id: memory.id });
  return Response.json({ id: row?.id });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(memory).where(and(eq(memory.id, id), eq(memory.userId, session.user.id)));
  return Response.json({ ok: true });
}
