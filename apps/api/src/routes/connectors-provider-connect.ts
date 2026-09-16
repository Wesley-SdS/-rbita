// Migrada do Next em paridade (apps/web/src/app/api/connectors/[provider]/connect/route.ts).
import { getConnector, isConfigured, type ConnectorId } from "@orbita/core/connectors/registry";
import { buildAuthorizeUrl } from "@orbita/core/connectors/store";
import { signState } from "@orbita/core/connectors/state";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/** Inicia o fluxo OAuth: redireciona o usuário para a tela de consentimento. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { provider } = ctx.params;
  const def = getConnector(provider);
  if (!def) return Response.json({ error: "Conector desconhecido" }, { status: 404 });
  if (!isConfigured(def.id as ConnectorId)) {
    return Response.json({ error: `Conector ${provider} não configurado no servidor` }, { status: 400 });
  }

  const state = signState(session.user.id);
  const url = buildAuthorizeUrl(def.id as ConnectorId, state);
  return Response.redirect(url, 302);
}
