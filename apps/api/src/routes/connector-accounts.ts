import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { definirContaPrincipal, desconectarConta, listarContas } from "@orbita/core/connectors/store";
import { rotuloDeExibicao } from "@orbita/core/connectors/identidade";
import { log } from "@orbita/core/observability/logger";

/**
 * As CONTAS de um conector, não o conector inteiro.
 *
 * O Google deixou de ser "conectado ou não": dá para ter a conta pessoal e a
 * do trabalho ao mesmo tempo. Então desconectar e escolher a principal passam
 * a ser por conta. A rota antiga (`DELETE /api/connectors/:provider`) continua
 * existindo e desconecta TODAS as contas daquele provedor, que é o que o botão
 * "desconectar o Google" faz.
 */

const Principal = z.object({ id: z.uuid() });

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await listarContas(session.user.id);
  return Response.json({
    contas: rows.map((r, i) => ({
      id: r.id,
      provider: r.provider,
      label: rotuloDeExibicao(r.accountLabel, i + 1),
      principal: r.principal,
      // falha de renovação é o que explica "a Órbita parou de ver meus e-mails"
      precisaReconectar: r.refreshFailures > 0,
      conectadaEm: r.createdAt.toISOString(),
    })),
  });
}

/** Troca qual conta responde quando o pedido não diz qual. */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Principal.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const ok = await definirContaPrincipal(session.user.id, parsed.data.id);
  if (!ok) return Response.json({ error: "Conta não encontrada" }, { status: 404 });
  log.info("connectors.principal", { userId: session.user.id, id: parsed.data.id });
  return Response.json({ ok: true });
}

/** Desconecta UMA conta. A rota do provedor continua desconectando todas. */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  const ok = await desconectarConta(session.user.id, id);
  if (!ok) return Response.json({ error: "Conta não encontrada" }, { status: 404 });
  log.info("connectors.desconectou_conta", { userId: session.user.id, id });
  return Response.json({ ok: true });
}
