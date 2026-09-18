import { createHash } from "node:crypto";
import { enqueueJob } from "@orbita/core/jobs/queue";
import { settings } from "@orbita/core/settings/index";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobAccepted } from "../http/job-response";

/**
 * Reunião gravada: transcrição com separação de vozes, quem é quem e, em
 * seguida, o resumo, tudo em segundo plano. Uma reunião longa leva minutos e a
 * aba pode ser fechada no meio sem perder nada.
 *
 * O `/api/stt` continua existindo, imediato, para o ditado de comando e para o
 * app mobile: é áudio de segundos, com a pessoa esperando o texto.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return Response.json({ error: "Arquivo de áudio ausente" }, { status: 400 });
  const maxMb = await settings.get("limits.sttMaxMb");
  if (file.size > maxMb * 1024 * 1024) {
    return Response.json({ error: `Áudio grande demais (${Math.round(file.size / 1048576)} MB). Limite: ${maxMb} MB.` }, { status: 413 });
  }
  if (!file.size) return Response.json({ error: "Nada foi gravado." }, { status: 400 });

  const expected = Number(form.get("speakers"));
  const speakers = Number.isInteger(expected) && expected >= 2 && expected <= 10 ? expected : null;
  const title = String(form.get("title") ?? "").trim().slice(0, 200) || null;

  const bytes = Buffer.from(await file.arrayBuffer());
  // a mesma gravação enviada duas vezes (clique duplo, reenvio) é o mesmo
  // trabalho enquanto ele não terminar
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  const r = await enqueueJob(session.user.id, {
    kind: "reuniao.transcrever",
    input: `data:${file.type || "audio/webm"};base64,${bytes.toString("base64")}`,
    payload: { speakers, title },
    dedupKey: `transcrever:${session.user.id}:${hash}`,
  });
  return jobAccepted(r.job, r.jaExistia);
}
