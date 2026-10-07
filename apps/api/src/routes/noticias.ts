import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobAccepted } from "../http/job-response";
import { enqueueJob } from "@orbita/core/jobs/queue";
import { deixarDeSeguir, marcarLida, noticiasDe, seguirTema, TemaInvalido } from "@orbita/core/noticias/servico";

/**
 * Notícias dos temas do dono (painel da tela inicial). Controller fino: a
 * busca, o resumo e o banco moram em `noticias/servico.ts`.
 *
 *   GET    /api/noticias                 temas com as notícias mais recentes
 *   POST   /api/noticias/temas {tema}    passa a seguir (e já busca, pela fila)
 *   DELETE /api/noticias/temas?id=       deixa de seguir (as notícias dele saem)
 *   POST   /api/noticias/atualizar       busca agora todos os temas (202 + trabalho)
 *   POST   /api/noticias/lida {id}       marca como lida
 */

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  return Response.json(await noticiasDe(session.user.id));
}

const NovoTema = z.object({ tema: z.string().trim().min(2, "Escreva o tema.").max(80) });

export async function POST_TEMA(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = NovoTema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Tema inválido." }, { status: 400 });
  try {
    const tema = await seguirTema(session.user.id, parsed.data.tema);
    // tema novo não espera o dia seguinte: a primeira busca sai agora
    const r = await enqueueJob(session.user.id, { kind: "noticias.buscar", payload: { temaId: tema.id, tema: tema.tema }, dedupKey: `noticias-tema:${tema.id}` });
    return Response.json({ tema, jobId: r.job.id });
  } catch (e) {
    if (e instanceof TemaInvalido) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE_TEMA(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "id obrigatório" }, { status: 400 });
  const ok = await deixarDeSeguir(session.user.id, id.data);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Tema não encontrado." }, { status: 404 });
}

export async function POST_ATUALIZAR(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  // dois cliques seguidos não viram duas buscas: o trabalho em andamento responde
  const r = await enqueueJob(session.user.id, { kind: "noticias.buscar", payload: {}, dedupKey: `noticias-agora:${session.user.id}` });
  return jobAccepted(r.job, r.jaExistia);
}

const Lida = z.object({ id: z.string().uuid() });

export async function POST_LIDA(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Lida.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await marcarLida(session.user.id, parsed.data.id);
  return Response.json({ ok: true });
}
