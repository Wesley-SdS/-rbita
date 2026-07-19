import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { widget } from "@/lib/db/widget-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  type: z.enum(["cotacao", "clima", "nota", "checklist"]),
  title: z.string().min(1).max(80),
  config: z.record(z.string(), z.unknown()).default({}),
});

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db.select().from(widget).where(eq(widget.userId, s.user.id)).orderBy(asc(widget.position), asc(widget.createdAt));
  return Response.json({ widgets: rows });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const [row] = await db.insert(widget).values({ userId: s.user.id, ...p.data }).returning({ id: widget.id });
  return Response.json({ id: row?.id });
}

/** Atualiza a config de um widget (ex: itens do checklist, texto da nota). */
export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const { id, config, title } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  const set: Record<string, unknown> = {};
  if (config !== undefined) set.config = config;
  if (title !== undefined) set.title = title;
  await db.update(widget).set(set).where(and(eq(widget.id, id), eq(widget.userId, s.user.id)));
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(widget).where(and(eq(widget.id, id), eq(widget.userId, s.user.id)));
  return Response.json({ ok: true });
}
