import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { person, personRoomAccess, room } from "@orbita/db/home-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

const Body = z.object({ personId: z.string().uuid(), roomId: z.string().uuid(), allowed: z.boolean() });

/** Confere que a pessoa e o cômodo são do dono desta sessão, antes de tocar a linha. */
async function ownsBoth(userId: string, personId: string, roomId: string): Promise<boolean> {
  const [p] = await db.select({ id: person.id }).from(person).where(and(eq(person.id, personId), eq(person.userId, userId))).limit(1);
  const [r] = await db.select({ id: room.id }).from(room).where(and(eq(room.id, roomId), eq(room.userId, userId))).limit(1);
  return Boolean(p && r);
}

/** PUT /api/home/person-access — libera ou nega uma pessoa num cômodo específico. */
export async function PUT(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  if (!(await ownsBoth(session.user.id, parsed.data.personId, parsed.data.roomId))) {
    return Response.json({ error: "Pessoa ou cômodo não encontrado" }, { status: 404 });
  }
  await db
    .insert(personRoomAccess)
    .values(parsed.data)
    .onConflictDoUpdate({ target: [personRoomAccess.personId, personRoomAccess.roomId], set: { allowed: parsed.data.allowed } });
  return Response.json({ ok: true });
}

/** DELETE /api/home/person-access?personId=...&roomId=... — volta ao padrão do papel (sem regra explícita). */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const u = new URL(req.url);
  const personId = u.searchParams.get("personId");
  const roomId = u.searchParams.get("roomId");
  if (!personId || !roomId) return Response.json({ error: "personId e roomId obrigatórios" }, { status: 400 });
  if (!(await ownsBoth(session.user.id, personId, roomId))) return Response.json({ error: "Pessoa ou cômodo não encontrado" }, { status: 404 });
  await db.delete(personRoomAccess).where(and(eq(personRoomAccess.personId, personId), eq(personRoomAccess.roomId, roomId)));
  return Response.json({ ok: true });
}
