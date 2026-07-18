import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notification } from "@/lib/db/routine-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
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
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (id) {
    await db.update(notification).set({ read: true }).where(and(eq(notification.id, id), eq(notification.userId, session.user.id)));
  } else {
    await db.update(notification).set({ read: true }).where(eq(notification.userId, session.user.id));
  }
  return Response.json({ ok: true });
}
