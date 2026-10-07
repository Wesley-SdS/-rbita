import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobAccepted } from "../http/job-response";
import { enqueueJob } from "@orbita/core/jobs/queue";
import { marcarVisto, trabalhoDe } from "@orbita/core/trabalho/servico";

/**
 * O trabalho do dono num lugar só (painel da tela inicial): as pendências dos
 * Jiras, o que chegou nas PRs do GitHub e as menções do Slack. Controller
 * fino: a leitura mora em `trabalho/servico.ts`.
 *
 *   GET  /api/trabalho              tudo consolidado
 *   POST /api/trabalho/atualizar    olha GitHub e Slack agora (202 + trabalho)
 *   POST /api/trabalho/visto {ids}  tira do destaque
 */

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  return Response.json(await trabalhoDe(session.user.id));
}

export async function POST_ATUALIZAR(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const r = await enqueueJob(session.user.id, { kind: "trabalho.vigiar", payload: {}, dedupKey: `trabalho-agora:${session.user.id}` });
  return jobAccepted(r.job, r.jaExistia);
}

const Visto = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

export async function POST_VISTO(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Visto.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido." }, { status: 400 });
  return Response.json({ ok: true, marcados: await marcarVisto(session.user.id, parsed.data.ids) });
}
