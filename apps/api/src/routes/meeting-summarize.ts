import { z } from "zod";
import { createHash } from "node:crypto";
import { enqueueJob } from "@orbita/core/jobs/queue";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobAccepted } from "../http/job-response";

const Body = z.object({
  // teto alto: a transcrição INTEIRA é arquivada no RAG (quem decide entre
  // passada única e mapa-redução é `summarizeMeeting`). ~500k chars cobre uma
  // reunião de várias horas.
  transcript: z.string().min(1).max(500000),
  title: z.string().max(200).optional(),
  // rótulos de voz não reconhecida criados na transcrição desta reunião: só
  // no resumo o documento existe para ligá-los à origem (Onda 9)
  desconhecidos: z.array(z.string().max(40)).max(20).optional(),
});

/**
 * Resume uma transcrição de reunião, extrai compromissos e arquiva no RAG.
 *
 * Virou trabalho de fila: uma reunião longa é mapa-redução com uma chamada de
 * LLM por bloco, e isso leva minutos. A rota só valida (400 na hora, não 202
 * para algo inválido) e devolve o recurso de status; o resumo sai em
 * `resultado` quando o trabalho termina. A lógica está em
 * `packages/core/src/meetings/summarize.ts`.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error?.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  // a mesma transcrição enviada duas vezes (clique duplo, aba recarregada) é o
  // mesmo trabalho enquanto ele não terminar
  const hash = createHash("sha256").update(parsed.data.transcript).digest("hex").slice(0, 24);
  const r = await enqueueJob(session.user.id, {
    kind: "reuniao.resumir",
    input: parsed.data.transcript,
    payload: { title: parsed.data.title ?? null, desconhecidos: parsed.data.desconhecidos ?? [] },
    dedupKey: `resumir:${session.user.id}:${hash}`,
  });
  return jobAccepted(r.job, r.jaExistia);
}
