import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { skill } from "@/lib/db/extension-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().min(1).max(80), instructions: z.string().min(1).max(4000), keywords: z.string().max(300).optional() });

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db.select().from(skill).where(eq(skill.userId, s.user.id)).orderBy(desc(skill.createdAt));
  return Response.json({ skills: rows });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const [row] = await db.insert(skill).values({ userId: s.user.id, ...p.data }).returning({ id: skill.id });
  return Response.json({ id: row?.id });
}

/** Liga/desliga uma skill. */
export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const { id, enabled } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.update(skill).set({ enabled: enabled !== false }).where(and(eq(skill.id, id), eq(skill.userId, s.user.id)));
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(skill).where(and(eq(skill.id, id), eq(skill.userId, s.user.id)));
  return Response.json({ ok: true });
}
