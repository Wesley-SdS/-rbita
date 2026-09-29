// Migrada do Next em paridade (apps/web/src/app/api/notifications/route.ts).
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@orbita/db";
import { notification } from "@orbita/db/routine-schema";
import { lerConsulta, listarAvisos } from "@orbita/core/avisos/listar";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/** `?de=pedidos` (Rotinas) · `?naoLidas=1` · `?antes=<ISO>` (carregar mais) · `?limite=` */
export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const q = lerConsulta(new URL(req.url));
  if (!q.ok) return Response.json({ error: q.erro }, { status: 400 });
  return Response.json(await listarAvisos(session.user.id, q.consulta));
}

/** Marca notificações como lidas (uma por id, ou todas). */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const corpo = z.object({ id: z.string().uuid().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!corpo.success) return Response.json({ error: "id inválido" }, { status: 400 });
  const { id } = corpo.data;
  if (id) {
    await db.update(notification).set({ read: true }).where(and(eq(notification.id, id), eq(notification.userId, session.user.id)));
  } else {
    await db.update(notification).set({ read: true }).where(eq(notification.userId, session.user.id));
  }
  return Response.json({ ok: true });
}
