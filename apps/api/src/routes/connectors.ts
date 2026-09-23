// Migrada do Next em paridade (apps/web/src/app/api/connectors/route.ts).
import { listConnectors } from "@orbita/core/connectors/registry";
import { connectorStatus } from "@orbita/core/connectors/store";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/** Lista os conectores: configurado (env presente) + conectado (pelo usuário). */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const defs = listConnectors();
  const { connected, labels, contas } = await connectorStatus(session.user.id);
  const connectors = defs.map((d) => ({
    ...d,
    connected: connected.has(d.id),
    // rótulo da conta PRINCIPAL, mantido para quem só mostra uma linha
    accountLabel: labels.get(d.id) ?? null,
    // e a lista inteira, que é o que a tela de conectores passa a mostrar
    contas: contas.filter((c) => c.provider === d.id),
  }));
  return Response.json({ connectors });
}
