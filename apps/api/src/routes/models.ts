// Migrada do Next em paridade (apps/web/src/app/api/models/route.ts).
import { availableModels, providerEnv, defaultModelKey, discoverModels, invalidateDiscovery } from "@orbita/llm";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { log } from "@orbita/core/observability/logger";

/**
 * Lista os modelos DESCOBERTOS nos provedores configurados, nada hardcoded.
 * Ollama (instalados na máquina) + Anthropic (liberados na assinatura) +
 * Gateway (catálogo completo, com preço) + provedores diretos.
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const started = Date.now();
  const [models, defaultModel] = await Promise.all([availableModels(), defaultModelKey()]);

  // agrupamento pronto para a UI: o eixo que importa é local vs nuvem
  const locais = models.filter((m) => m.local && m.key !== "auto").length;
  log.info("models.list", { userId: session.user.id, total: models.length, locais, ms: Date.now() - started });

  return Response.json(
    { models, env: providerEnv(), defaultModel, counts: { total: models.length - 1, locais, nuvem: models.length - 1 - locais } },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}

/** Força uma nova descoberta (o dono instalou um modelo ou trocou uma chave). */
export async function POST(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  invalidateDiscovery();
  const models = await discoverModels({ force: true });
  log.info("models.refresh", { userId: session.user.id, total: models.length });
  return Response.json({ ok: true, total: models.length });
}
