import { z } from "zod";
import { cancelJob, getJob, listJobs } from "@orbita/core/jobs/queue";
import { toJobView } from "@orbita/core/jobs/registry";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobStatus } from "../http/job-response";

/**
 * Trabalhos em segundo plano: a lista (para o painel) e o recurso de status de
 * cada um (para quem enfileirou acompanhar). Cancelar é DELETE no próprio
 * recurso, como no padrão Asynchronous Request-Reply: não apaga o registro,
 * pede para parar, e o trabalho para no próximo ponto seguro.
 */

const Status = z.enum(["pendente", "rodando", "feito", "falhou", "cancelado"]);

/** GET /api/jobs?status=rodando,pendente&limite=30 */
export async function GET(req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const bruto = url.searchParams.get("status");
  const status = bruto ? z.array(Status).safeParse(bruto.split(",").map((x) => x.trim()).filter(Boolean)) : null;
  if (status && !status.success) return Response.json({ error: "status inválido" }, { status: 400 });
  const limite = z.coerce.number().int().min(1).max(100).catch(30).parse(url.searchParams.get("limite") ?? 30);
  const rows = await listJobs(s.user.id, { status: status?.data, limite });
  return Response.json({ trabalhos: rows.map(toJobView) });
}

const Id = z.string().uuid();

/** GET /api/jobs/:id */
export async function GET_ONE(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = Id.safeParse(ctx.params.id);
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  const j = await getJob(s.user.id, id.data);
  if (!j) return Response.json({ error: "Trabalho não encontrado" }, { status: 404 });
  return jobStatus(j);
}

/** DELETE /api/jobs/:id: pede para parar. 202 porque parar também não é instantâneo. */
export async function DELETE_ONE(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = Id.safeParse(ctx.params.id);
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  const j = await cancelJob(s.user.id, id.data);
  if (!j) return Response.json({ error: "Trabalho não encontrado" }, { status: 404 });
  return Response.json(toJobView(j), { status: j.status === "rodando" ? 202 : 200 });
}
