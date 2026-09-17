import { currentPresence } from "@orbita/core/identity/presence";
import type { RouteCtx } from "../http/web";
import { ownerOf } from "../http/owner-route";

/**
 * GET /api/identity/presence — quem está onde, com a idade do avistamento
 * ("agora", "recente", "antigo"). A Órbita nunca afirma presença velha como se
 * fosse atual (PRD §7: identificação sai sempre com confiança e contexto).
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  return Response.json({ presenca: await currentPresence(o.userId) });
}
