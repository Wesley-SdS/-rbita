// Migrada do Next em paridade (apps/web/src/app/api/realtime/config/route.ts).
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { settings } from "@orbita/core/settings/index";
import { escolherProvedorRealtime } from "@orbita/core/realtime/provider";
import { chavesRealtime } from "./realtime-session";

/**
 * Diz à UI se o modo tempo real está disponível e QUEM vai atender.
 *
 * O cache é curto de propósito: isto deixou de depender só do ambiente quando
 * o provedor virou config (`realtime.provider`), e mudar config não pode exigir
 * restart nem esperar cinco minutos para a tela concordar (CLAUDE.md §5.6).
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const pref = await settings.get("realtime.provider");
  const provider = escolherProvedorRealtime(pref, chavesRealtime());

  return Response.json(
    { enabled: provider !== null, provider },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
