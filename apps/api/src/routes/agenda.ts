import { proximosEventos } from "@orbita/core/agenda/proximos";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * A agenda da tela (Visão geral e Reuniões), de todas as contas.
 * Sem `leituraCacheavel` de propósito: com quem o dono se reúne é dado pessoal,
 * e o que é cacheável vai para o cache offline do navegador.
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  return Response.json(await proximosEventos(session.user.id));
}
