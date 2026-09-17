import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { person, personRoomAccess, room } from "@orbita/db/home-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * Pessoas da casa e acesso por cômodo (B7.1). NÃO é multi-tenant: toda pessoa
 * pertence à mesma conta do dono. Hoje isto é só o CADASTRO — a aplicação
 * ainda não tem um sinal de "quem está falando" (voz/dispositivo, Onda 6)
 * para de fato restringir uma ação em tempo real; a regra de permissão já
 * existe pronta em packages/core/src/home/permission.ts.
 */
const Body = z.object({ name: z.string().min(1).max(80), role: z.enum(["dono", "morador", "visitante"]).default("morador") });

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const [people, access] = await Promise.all([
    db.select().from(person).where(eq(person.userId, session.user.id)),
    db
      .select({ personId: personRoomAccess.personId, roomId: personRoomAccess.roomId, allowed: personRoomAccess.allowed, roomName: room.name })
      .from(personRoomAccess)
      .innerJoin(room, eq(room.id, personRoomAccess.roomId))
      .innerJoin(person, eq(person.id, personRoomAccess.personId))
      .where(eq(person.userId, session.user.id)),
  ]);
  return Response.json({
    people: people.map((p) => ({ id: p.id, name: p.name, role: p.role, access: access.filter((a) => a.personId === p.id) })),
  });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const [row] = await db
    .insert(person)
    .values({ userId: session.user.id, name: parsed.data.name, role: parsed.data.role })
    .returning({ id: person.id });
  return Response.json({ id: row?.id });
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(person).where(and(eq(person.id, id), eq(person.userId, session.user.id)));
  return Response.json({ ok: true });
}
