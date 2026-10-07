import { z } from "zod";
import { getConnector, type ConnectorId } from "@orbita/core/connectors/registry";
import { salvarConexaoPorToken } from "@orbita/core/connectors/store";
import { TokenRecusado } from "@orbita/core/connectors/por-token";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * POST /api/connectors/:provider/token {valores}: conecta colando um token
 * (GitHub, Jira, Slack). O token é conferido no serviço antes de ser guardado;
 * a resposta diz de quem é a conta, para a tela confirmar que entrou a certa.
 */
const Corpo = z.object({ valores: z.record(z.string().max(60), z.string().max(4000)).refine((v) => Object.keys(v).length <= 6) });

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const def = getConnector(ctx.params.provider ?? "");
  if (!def?.porToken) return Response.json({ error: "Este serviço não conecta por token." }, { status: 404 });
  const parsed = Corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Preencha os campos." }, { status: 400 });
  try {
    const { label } = await salvarConexaoPorToken(def.id as ConnectorId, session.user.id, parsed.data.valores);
    return Response.json({ ok: true, label });
  } catch (e) {
    if (e instanceof TokenRecusado) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
