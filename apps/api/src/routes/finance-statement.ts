import { enqueueJob } from "@orbita/core/jobs/queue";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobAccepted } from "../http/job-response";
import { readUploadedFile } from "../http/upload-file";

/**
 * Extrato (PDF ou texto) vira lançamentos, bloco a bloco. Virou trabalho de
 * fila; a lógica está em `packages/core/src/finance/documents.ts`.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const f = await readUploadedFile(req, "Arquivo ausente");
  if (f instanceof Response) return f;
  const r = await enqueueJob(session.user.id, { kind: "financas.extrato", input: f.dataUrl, payload: { nome: f.nome } });
  return jobAccepted(r.job, r.jaExistia);
}
