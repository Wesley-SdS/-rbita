// Migrada do Next em paridade (apps/web/src/app/api/account/reindex/route.ts),
// e depois virou trabalho de fila (R2): reindexar o acervo inteiro é uma
// chamada de embedding por lote para todos os documentos e memórias. Com modelo
// local isso passa de minutos, e ninguém segura uma requisição HTTP nisso.
import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { settings } from "@orbita/core/settings/index";
import { sessionOf } from "../http/web-route";
import { rateLimit, tooMany } from "@orbita/core/ratelimit";
import { enqueueJob } from "@orbita/core/jobs/queue";
import { tamanhoDoAcervo } from "@orbita/core/rag/reindex";
import { jobAccepted } from "../http/job-response";

const Body = z.object({
  /** recortar = corta os documentos de novo (dá página aos antigos); recalcular = só refaz os vetores */
  modo: z.enum(["recortar", "recalcular"]).default("recortar"),
});

/** Quanto há para reindexar: a tela mostra antes de o dono mandar. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  return Response.json(await tamanhoDoAcervo(session.user.id));
}

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const uid = session.user.id;

  const rl = rateLimit(`reindex:${uid}`, await settings.get("limits.reindexPerMinute"), 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* corpo vazio é válido: usa o padrão */
  }
  const parsed = Body.safeParse(body ?? {});
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  // dedup: duas reindexações do mesmo acervo ao mesmo tempo só gastariam CPU
  const r = await enqueueJob(uid, {
    kind: "rag.reindexar",
    payload: { modo: parsed.data.modo },
    dedupKey: `reindexar:${uid}`,
  });
  return jobAccepted(r.job, r.jaExistia);
}
