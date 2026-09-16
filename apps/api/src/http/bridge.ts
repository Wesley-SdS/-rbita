import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "@orbita/core/auth";
import { log } from "@orbita/core/observability/logger";
import { sendWebResponse, toWebRequest, type RouteHandler } from "./web";

/**
 * Executa uma rota migrada (assinatura Web) a partir do Express: resolve a
 * sessão pelo cookie (mesma instância do Better Auth), monta o Request e
 * despeja o Response. A rota decide o 401; aqui só entregamos `ctx.user`.
 */
export async function bridge(req: ExpressRequest, res: ExpressResponse, handler: RouteHandler): Promise<void> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
  const user = session ? { id: session.user.id, email: session.user.email, name: session.user.name } : null;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.params ?? {})) params[k] = String(v);
  const started = Date.now();
  try {
    const out = await handler(toWebRequest(req, res), { params, user });
    await sendWebResponse(req, res, out);
  } catch (e) {
    log.error("api.rota_falhou", { path: req.path, error: e instanceof Error ? e.message : String(e) });
    if (!res.headersSent) res.status(500).json({ error: "Erro interno" });
    else res.end();
  } finally {
    log.info("req", { method: req.method, path: req.path, ms: Date.now() - started, status: res.statusCode });
  }
}

/** Resposta 401 padrão das rotas (mesmo texto de sempre). */
export const unauthorized = () => Response.json({ error: "Não autenticado" }, { status: 401 });
