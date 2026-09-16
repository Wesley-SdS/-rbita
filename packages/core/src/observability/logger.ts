/**
 * Logger estruturado (JSON por linha) — pronto para coleta por Loki/Datadog/etc.
 * Em dev imprime legível; em produção, JSON. Sem dependências externas.
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;
const PRETTY = process.env.NODE_ENV !== "production";

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return;
  const rec = { ts: new Date().toISOString(), level, msg, ...fields };
  const line = PRETTY
    ? `${rec.ts} ${level.toUpperCase().padEnd(5)} ${msg}${fields ? " " + JSON.stringify(fields) : ""}`
    : JSON.stringify(rec);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};

/** Mede a duração de uma operação assíncrona e loga início/fim. */
export async function timed<T>(name: string, fn: () => Promise<T>, fields?: Record<string, unknown>): Promise<T> {
  const started = Date.now();
  try {
    const out = await fn();
    log.info(`${name} ok`, { ...fields, ms: Date.now() - started });
    return out;
  } catch (e) {
    log.error(`${name} falhou`, { ...fields, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
