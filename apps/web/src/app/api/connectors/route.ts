import { listConnectors } from "@/lib/connectors/registry";
import { connectorStatus } from "@/lib/connectors/store";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lista os conectores: configurado (env presente) + conectado (pelo usuário). */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const defs = listConnectors();
  const { connected, labels } = await connectorStatus(session.user.id);
  const connectors = defs.map((d) => ({
    ...d,
    connected: connected.has(d.id),
    accountLabel: labels.get(d.id) ?? null,
  }));
  return Response.json({ connectors });
}
