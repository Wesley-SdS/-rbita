import { z } from "zod";
import { listGuidedTasks, setGuidedStep, startGuidedTask, stopGuidedTask } from "@orbita/core/guided/task";
import type { RouteCtx } from "../http/web";
import { domainError, ownerOf } from "../http/owner-route";

/**
 * Acompanhar tarefa passo a passo pela câmera (PRD §5.4). A tela existe para o
 * dono ver em que passo está, corrigir na mão e, principalmente, PARAR: é
 * câmera olhando o cômodo de tempos em tempos, então encerrar precisa estar a
 * um clique, não só numa frase para o modelo.
 */

export async function GET(_req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  return Response.json({ tarefas: await listGuidedTasks(o.userId) });
}

const StartBody = z.object({
  titulo: z.string().min(2).max(120),
  passos: z.array(z.string().min(1).max(300)).min(1).max(100),
  comodo: z.string().min(1).max(60),
});

export async function POST(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const parsed = StartBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const t = await startGuidedTask(o.userId, parsed.data);
    return Response.json({ id: t.id, titulo: t.title, passos: t.steps.length, intervaloSegundos: t.intervalSeconds, expiraEm: t.expiresAt });
  } catch (e) {
    return domainError(e);
  }
}

const StepBody = z.object({ id: z.string().uuid().nullable().optional(), passo: z.number().int().min(0).max(100) });

export async function PATCH(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const parsed = StepBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const t = await setGuidedStep(o.userId, parsed.data.id ?? null, parsed.data.passo);
    return Response.json(t ? { ok: true, passo: t.currentStep, status: t.status } : { ok: true, aviso: "Nenhuma tarefa ativa." });
  } catch (e) {
    return domainError(e);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const id = new URL(req.url).searchParams.get("id");
  if (id && !z.string().uuid().safeParse(id).success) return Response.json({ error: "id inválido" }, { status: 400 });
  try {
    const t = await stopGuidedTask(o.userId, id, "cancelada");
    return Response.json({ ok: true, encerrada: t?.title ?? null });
  } catch (e) {
    return domainError(e);
  }
}
