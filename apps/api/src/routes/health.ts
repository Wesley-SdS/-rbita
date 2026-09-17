// Migrada do Next em paridade (apps/web/src/app/api/health/route.ts).
import { sql } from "drizzle-orm";
import { db } from "@orbita/db";
import type { RouteCtx } from "../http/web";
import { settings } from "@orbita/core/settings/index";

async function ping(url: string, ms: number): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Health detalhado: banco + serviço de voz + Ollama (dependências externas). */
export async function GET(_req: Request, _ctx: RouteCtx) {
  const started = Date.now();
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`select 1`);
    checks.db = "up";
  } catch {
    checks.db = "down";
  }

  // a config é fail-soft: sem banco, vale o default e o health continua respondendo
  const pingMs = await settings.get("resilience.healthPingMs");
  const voiceUrl = process.env.VOICE_URL ?? "http://localhost:8001";
  checks.voice = (await ping(voiceUrl + "/health", pingMs)) ? "up" : "down";

  const ollama = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
  checks.ollama = (await ping(ollama + "/api/tags", pingMs)) ? "up" : "down";

  // percepção (Fase 2): sem ela, voz e rosto simplesmente não identificam. Não
  // derruba o health (o resto da Órbita funciona), mas precisa aparecer.
  const percepcao = await settings.get("identity.perceptionUrl");
  checks.perception = (await ping(percepcao.replace(/\/+$/, "") + "/health", pingMs)) ? "up" : "down";

  const status = checks.db === "up" ? "ok" : "error";
  return Response.json(
    { status, db: checks.db, checks, ms: Date.now() - started, ts: new Date().toISOString() },
    { status: status === "ok" ? 200 : 503 },
  );
}
