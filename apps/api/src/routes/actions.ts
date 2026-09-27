// Migrada do Next em paridade (apps/web/src/app/api/actions/route.ts).
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@orbita/db";
import { actionQueue } from "@orbita/db/action-schema";
import { aprovarAcao } from "@orbita/core/actions/aprovar";
import { aprovarPorFrase } from "@orbita/core/actions/por-frase";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * O gate humano (§5.1) também valida a entrada.
 *
 * `payload` é opcional e é a proposta CORRIGIDA por quem aprova: o dono passou
 * a poder ajustar a ação na própria conversa antes de confirmar. Vir do
 * navegador não a torna suspeita, ao contrário: é a pessoa, com sessão, que a
 * digitou, e é exatamente isso que o gate protege. Ausente, vale a proposta que
 * o modelo montou, como sempre.
 */
const ActionIdBody = z.object({
  id: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

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

/** Aprova (executa) uma ação da fila. Gate humano: a execução mora em core/actions/aprovar.ts. */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = ActionIdBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "id obrigatório" }, { status: 400 });
  const r = await aprovarAcao(session.user.id, parsed.data.id, parsed.data.payload);
  return r.ok ? Response.json({ ok: true, result: r.resultado }) : Response.json({ error: r.erro }, { status: r.status });
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

const Falada = z.object({ texto: z.string().min(1).max(500) });

/**
 * POST /api/actions/falada — o dono respondeu FALANDO a uma proposta feita na
 * conversa por voz ("manda", "cancela", "manda a 2"). O navegador repassa só a
 * transcrição da fala DO DONO (nunca o que o modelo disse); quem decide se é
 * aprovação é o código, com a sessão do dono, exatamente como o botão.
 */
export async function POST_FALADA(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Falada.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "texto obrigatório" }, { status: 400 });
  const resposta = await aprovarPorFrase(session.user.id, "voz", parsed.data.texto);
  return Response.json({ tratado: resposta !== null, resposta });
}
