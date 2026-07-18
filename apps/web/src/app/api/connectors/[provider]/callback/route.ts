import { getConnector, type ConnectorId } from "@/lib/connectors/registry";
import { exchangeCodeAndSave } from "@/lib/connectors/store";
import { verifyState } from "@/lib/connectors/state";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Callback do OAuth: valida o state, troca o code por tokens e persiste. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const def = getConnector(provider);
  const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const back = (status: string) => Response.redirect(`${appUrl}/app?connector=${provider}&status=${status}`, 302);

  if (!def) return back("desconhecido");

  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  if (err) return back(`erro_${err}`);

  const code = url.searchParams.get("code");
  const stateUserId = verifyState(url.searchParams.get("state"));
  if (!code || !stateUserId) return back("state_invalido");

  // Defesa extra: o state assinado deve bater com a sessão atual.
  const session = await getSession();
  if (!session || session.user.id !== stateUserId) return back("sessao_invalida");

  try {
    await exchangeCodeAndSave(def.id as ConnectorId, stateUserId, code);
    return back("conectado");
  } catch (e) {
    console.error(`[connectors] falha no callback ${provider}:`, e);
    return back("falha_token");
  }
}
