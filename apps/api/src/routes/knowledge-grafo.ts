import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { apagarDoConhecimento, montarGrafoDoUsuario } from "@orbita/core/knowledge/grafo-query";
import { arquivarConversa } from "@orbita/core/knowledge/conversas";
import { log } from "@orbita/core/observability/logger";

/**
 * GET /api/knowledge/grafo — o mapa do que a Órbita sabe.
 *
 * Substitui na prática o `/api/knowledge/graph`, que ligava memória com
 * memória por similaridade e nunca teve tela. A rota velha continua de pé
 * (alguém pode estar chamando), mas é esta que a tela usa.
 */

const TIPOS = ["conversa", "documento", "reuniao", "tarefa", "memoria", "pessoa"] as const;

export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const tipos = url.searchParams.getAll("tipo").filter((t) => (TIPOS as readonly string[]).includes(t));
  const comParecidos = url.searchParams.get("parecidos") === "1";

  const grafo = await montarGrafoDoUsuario(session.user.id, { tipos, comParecidos });
  return Response.json(grafo);
}

const Arquivar = z.object({ conversationId: z.uuid(), refazer: z.boolean().optional() });

/** POST /api/knowledge/grafo — arquiva uma conversa na base (ela vira um nó do mapa). */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Arquivar.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const r = await arquivarConversa(session.user.id, parsed.data.conversationId, { refazer: parsed.data.refazer });
  log.info("conhecimento.arquivar", { userId: session.user.id, conversationId: parsed.data.conversationId, motivo: r.motivo });
  return Response.json(r);
}

/** DELETE /api/knowledge/grafo?tipo=&id= — tira uma coisa da base, de verdade. */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!tipo || !id) return Response.json({ error: "tipo e id obrigatórios" }, { status: 400 });

  const apagou = await apagarDoConhecimento(session.user.id, tipo, id);
  if (!apagou) {
    // 404 e não 200: apagar algo que não é seu, ou de um tipo que não se apaga
    // por aqui, precisa falhar de forma visível
    return Response.json({ error: "Não encontrei isso, ou esse tipo não se apaga pelo mapa." }, { status: 404 });
  }
  log.info("conhecimento.apagado", { userId: session.user.id, tipo, id });
  return Response.json({ ok: true });
}
