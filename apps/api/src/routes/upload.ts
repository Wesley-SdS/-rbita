import { enqueueJob } from "@orbita/core/jobs/queue";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobAccepted } from "../http/job-response";
import { readUploadedFile } from "../http/upload-file";

/**
 * Upload de arquivo (PDF, imagem por OCR ou texto) para indexar no RAG. Virou
 * trabalho de fila: PDF grande e OCR levam dezenas de segundos. A lógica está em
 * `packages/core/src/rag/files.ts`.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const f = await readUploadedFile(req, "Arquivo ausente");
  if (f instanceof Response) return f;
  const r = await enqueueJob(session.user.id, { kind: "rag.indexar_arquivo", input: f.dataUrl, payload: { nome: f.nome } });
  return jobAccepted(r.job, r.jaExistia);
}
