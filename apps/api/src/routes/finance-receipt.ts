import { enqueueJob } from "@orbita/core/jobs/queue";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobAccepted } from "../http/job-response";
import { readUploadedFile } from "../http/upload-file";

/**
 * Comprovante ou cupom (foto) vira lançamento: OCR, modelo de visão se o OCR
 * não ler, e o modelo estrutura os campos. Virou trabalho de fila; a lógica
 * está em `packages/core/src/finance/documents.ts`.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const f = await readUploadedFile(req, "Imagem ausente");
  if (f instanceof Response) return f;
  if (!f.mime.startsWith("image/")) return Response.json({ error: "Envie uma foto do comprovante." }, { status: 400 });
  const r = await enqueueJob(session.user.id, { kind: "financas.cupom", input: f.dataUrl, payload: { nome: f.nome } });
  return jobAccepted(r.job, r.jaExistia);
}
