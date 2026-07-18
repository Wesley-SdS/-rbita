import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { todo } from "@/lib/db/todo-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  text: z.string().min(1).max(500),
  dueDate: z.string().datetime().optional(),
  imageUrl: z.string().max(3_000_000).optional(), // data URL (imagem pequena)
});

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select()
    .from(todo)
    .where(eq(todo.userId, session.user.id))
    .orderBy(asc(todo.done), asc(todo.createdAt));
  return Response.json({ todos: rows.map((t) => ({ ...t, dueDate: t.dueDate?.toISOString() ?? null })) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const [row] = await db
    .insert(todo)
    .values({
      userId: session.user.id,
      text: parsed.data.text,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      imageUrl: parsed.data.imageUrl ?? null,
    })
    .returning({ id: todo.id });
  return Response.json({ id: row?.id });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const { id, done } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.update(todo).set({ done: done === true }).where(and(eq(todo.id, id), eq(todo.userId, session.user.id)));
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(todo).where(and(eq(todo.id, id), eq(todo.userId, session.user.id)));
  return Response.json({ ok: true });
}
