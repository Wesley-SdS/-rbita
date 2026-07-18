import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ping(url: string, ms = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Health detalhado: banco + serviço de voz + Ollama (dependências externas). */
export async function GET() {
  const started = Date.now();
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`select 1`);
    checks.db = "up";
  } catch {
    checks.db = "down";
  }

  const voiceUrl = process.env.VOICE_URL ?? "http://localhost:8001";
  checks.voice = (await ping(voiceUrl + "/health")) ? "up" : "down";

  const ollama = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
  checks.ollama = (await ping(ollama + "/api/tags")) ? "up" : "down";

  const status = checks.db === "up" ? "ok" : "error";
  return Response.json(
    { status, db: checks.db, checks, ms: Date.now() - started, ts: new Date().toISOString() },
    { status: status === "ok" ? 200 : 503 },
  );
}
