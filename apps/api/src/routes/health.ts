// Migrada do Next em paridade (apps/web/src/app/api/health/route.ts).
import { sql } from "drizzle-orm";
import { db } from "@orbita/db";
import type { RouteCtx } from "../http/web";
import { settings } from "@orbita/core/settings/index";
import { deveDescobrirLocal, embedProvider, localAvailable, readPolicy } from "@orbita/llm";
import { temChaveDeNuvem } from "@orbita/core/ocr/visao";
import { estadoDoServico, ollamaEmUso, vozLocalEmUso } from "@orbita/core/saude/servicos-locais";

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
  const [cfg, politica] = await Promise.all([
    settings.getMany(["resilience.healthPingMs", "embeddings.provider", "ocr.visionProvider", "voice.wakeEngine"]),
    readPolicy(),
  ]);
  const pingMs = cfg["resilience.healthPingMs"];

  // serviço que nenhum caminho usa sai como "nao_usado" e nem é pingado:
  // "down" num serviço que a casa escolheu não usar ensina a ignorar o painel
  const vozEmUso = vozLocalEmUso({
    ttsProvider: process.env.TTS_PROVIDER ?? "auto",
    wakeEngine: cfg["voice.wakeEngine"],
    temChaveDeTranscricao: Boolean(process.env.ASSEMBLYAI_API_KEY),
  });
  const voiceUrl = process.env.VOICE_URL ?? "http://localhost:8001";
  checks.voice = estadoDoServico(vozEmUso, vozEmUso && (await ping(voiceUrl + "/health", pingMs)));

  const ollamaUsado = ollamaEmUso({
    politicaUsaLocal: deveDescobrirLocal(politica, process.env),
    alcancavel: localAvailable(),
    embeddingsProvider: cfg["embeddings.provider"],
    temChaveDeEmbedding: embedProvider() === "cloud",
    ocrVisionProvider: cfg["ocr.visionProvider"],
    temChaveDeNuvem: temChaveDeNuvem(),
  });
  const ollama = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
  checks.ollama = estadoDoServico(ollamaUsado, ollamaUsado && (await ping(ollama + "/api/tags", pingMs)));

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
