// Migrada do Next em paridade (apps/web/src/app/api/ingest/route.ts).
import { z } from "zod";
import { enqueueJob } from "@orbita/core/jobs/queue";
import { jobAccepted } from "../http/job-response";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { rateLimit, tooMany } from "@orbita/core/ratelimit";
import { settings } from "@orbita/core/settings/index";

const Body = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(200000),
});

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const rl = rateLimit(`ingest:${session.user.id}`, await settings.get("limits.ingestPerMinute"), 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  if (!parsed.data.content.trim()) return Response.json({ error: "Conteúdo vazio" }, { status: 400 });
  // embeddings de muitos trechos levam tempo: vira trabalho de fila
  const r = await enqueueJob(session.user.id, { kind: "rag.indexar_texto", input: parsed.data.content, payload: { title: parsed.data.title } });
  return jobAccepted(r.job, r.jaExistia);
}
