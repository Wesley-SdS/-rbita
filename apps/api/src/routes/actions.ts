// Migrada do Next em paridade (apps/web/src/app/api/actions/route.ts).
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@orbita/db";
import { actionQueue } from "@orbita/db/action-schema";
import { executeAction } from "@orbita/core/connectors/execute";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { log } from "@orbita/core/observability/logger";
import { events } from "@orbita/core/events/index";

/** O gate humano (§5.1) também valida a entrada: id é uuid, e nada além dele. */
const ActionIdBody = z.object({ id: z.string().uuid() });

/** Lista as ações pendentes de aprovação do usuário. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select()
    .from(actionQueue)
    .where(and(eq(actionQueue.userId, session.user.id), eq(actionQueue.status, "pending")))
    .orderBy(desc(actionQueue.createdAt));
  return Response.json({ actions: rows });
}

/** Aprova (executa) uma ação da fila. Gate humano: só aqui a ação acontece. */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = ActionIdBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "id obrigatório" }, { status: 400 });
  const { id } = parsed.data;

  const [action] = await db
    .select()
    .from(actionQueue)
    .where(and(eq(actionQueue.id, id), eq(actionQueue.userId, session.user.id), eq(actionQueue.status, "pending")))
    .limit(1);
  if (!action) return Response.json({ error: "Ação não encontrada ou já processada" }, { status: 404 });

  try {
    const result = await executeAction(session.user.id, action.kind, action.payload as Record<string, unknown>);
    await db.update(actionQueue).set({ status: "done", result }).where(eq(actionQueue.id, id));
    log.info("action.executed", { userId: session.user.id, kind: action.kind });
    // vai para o outbox: o processo persistente lê e dispara as regras (ex.: "avisar quando enviar e-mail")
    await events.emit("action.executed", { kind: action.kind, summary: action.summary, result }, { userId: session.user.id });
    return Response.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha";
    await db.update(actionQueue).set({ status: "failed", result: msg }).where(eq(actionQueue.id, id));
    log.error("action.failed", { userId: session.user.id, kind: action.kind, error: msg });
    return Response.json({ error: msg }, { status: 502 });
  }
}

/** Cancela (rejeita) uma ação pendente. */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id")).data;
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db
    .update(actionQueue)
    .set({ status: "cancelled" })
    .where(and(eq(actionQueue.id, id), eq(actionQueue.userId, session.user.id)));
  return Response.json({ ok: true });
}
