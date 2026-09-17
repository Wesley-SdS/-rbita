import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { room } from "@orbita/db/home-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

const Body = z.object({ name: z.string().min(1).max(60), icon: z.string().max(8).optional() });

/** GET /api/home/rooms */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db.select().from(room).where(eq(room.userId, session.user.id));
  return Response.json({ rooms: rows });
}

/** POST /api/home/rooms — cômodo é dado do dono, sem lista fixa (B3.7). */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const [row] = await db
    .insert(room)
    .values({ userId: session.user.id, name: parsed.data.name, icon: parsed.data.icon ?? null })
    .returning({ id: room.id });
  return Response.json({ id: row?.id });
}

/** DELETE /api/home/rooms?id=... */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(room).where(and(eq(room.id, id), eq(room.userId, session.user.id)));
  return Response.json({ ok: true });
}
