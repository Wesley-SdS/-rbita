/**
 * Rate limiting simples em memória (janela fixa). Adequado para instância única
 * (self-host/local). Em cluster, trocar por Redis — a interface fica igual.
 *
 * Protege contra brute force de login e custo-DoS (loops em /api/chat, que
 * dispara LLM+embeddings+RAG a cada chamada).
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// varredura preguiçosa para não crescer sem limite
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Consome 1 do balde `key`. Retorna ok=false quando estoura o limite na janela. */
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { ok: true, remaining: limit - b.count, retryAfterSec: 0 };
}

/** IP do cliente a partir dos headers de proxy (fallback para "local"). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Resposta 429 padronizada com Retry-After. */
export function tooMany(retryAfterSec: number): Response {
  return Response.json(
    { error: `Muitas requisições. Tente de novo em ${retryAfterSec}s.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
