// Migrada do Next em paridade (apps/web/src/app/api/connectors/[provider]/route.ts).
import { getConnector, type ConnectorId } from "@orbita/core/connectors/registry";
import { disconnect } from "@orbita/core/connectors/store";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/** Desconecta um conector (apaga os tokens do usuário). */
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const { provider } = ctx.params;
  const def = getConnector(provider);
  if (!def) return Response.json({ error: "Conector desconhecido" }, { status: 404 });
  await disconnect(def.id as ConnectorId, session.user.id);
  return Response.json({ ok: true });
}
