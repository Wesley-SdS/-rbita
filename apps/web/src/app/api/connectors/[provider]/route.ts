import { getConnector, type ConnectorId } from "@/lib/connectors/registry";
import { disconnect } from "@/lib/connectors/store";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Desconecta um conector (apaga os tokens do usuário). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const { provider } = await params;
  const def = getConnector(provider);
  if (!def) return Response.json({ error: "Conector desconhecido" }, { status: 404 });
  await disconnect(def.id as ConnectorId, session.user.id);
  return Response.json({ ok: true });
}
