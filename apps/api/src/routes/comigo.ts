import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { comigoDe } from "@orbita/core/comigo/servico";

/**
 * O que está com o dono na gestão e nos chamados da Adalink, mais os chamados
 * atrasados da equipe (painel da tela inicial). Controller fino: a leitura e
 * as regras moram em `core/comigo/`.
 *
 *   GET /api/comigo            a última leitura (reaproveitada por `comigo.cacheSegundos`)
 *   GET /api/comigo?fresco=1   lê os dois sistemas agora
 */
export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const fresco = new URL(req.url).searchParams.get("fresco") === "1";
  return Response.json(await comigoDe(session.user.id, { fresco }));
}
