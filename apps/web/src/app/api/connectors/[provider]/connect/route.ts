import { getConnector, isConfigured, type ConnectorId } from "@/lib/connectors/registry";
import { buildAuthorizeUrl } from "@/lib/connectors/store";
import { signState } from "@/lib/connectors/state";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Inicia o fluxo OAuth: redireciona o usuário para a tela de consentimento. */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { provider } = await params;
  const def = getConnector(provider);
  if (!def) return Response.json({ error: "Conector desconhecido" }, { status: 404 });
  if (!isConfigured(def.id as ConnectorId)) {
    return Response.json({ error: `Conector ${provider} não configurado no servidor` }, { status: 400 });
  }

  const state = signState(session.user.id);
  const url = buildAuthorizeUrl(def.id as ConnectorId, state);
  return Response.redirect(url, 302);
}
