// Migrada do Next em paridade (apps/web/src/app/api/notifications/route.ts).
import { and, desc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { notification } from "@orbita/db/routine-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select()
    .from(notification)
    .where(eq(notification.userId, session.user.id))
    .orderBy(desc(notification.createdAt))
    .limit(30);
  return Response.json({ notifications: rows, unread: rows.filter((r) => !r.read).length });
}

/** Marca notificações como lidas (uma por id, ou todas). */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (id) {
    await db.update(notification).set({ read: true }).where(and(eq(notification.id, id), eq(notification.userId, session.user.id)));
  } else {
    await db.update(notification).set({ read: true }).where(eq(notification.userId, session.user.id));
  }
  return Response.json({ ok: true });
}
