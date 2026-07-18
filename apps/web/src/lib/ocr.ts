import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * OCR de imagem (tesseract.js, pt+en). No Next.js/Turbopack o worker-script não
 * é localizado automaticamente ("Cannot find module .../worker-script/node").
 * Resolvemos o caminho absoluto do worker de forma robusta (sem string literal,
 * que o bundler reescreveria) e o passamos explicitamente ao createWorker.
 * Requer `serverExternalPackages: ["tesseract.js"]` no next.config.
 */
function resolveWorkerPath(): string | undefined {
  const rel = "tesseract.js/src/worker-script/node/index.js";
  // 1) require.resolve com módulo em variável (evita a reescrita estática do bundler)
  try {
    const require = createRequire(import.meta.url);
    const p = require.resolve(rel);
    if (path.isAbsolute(p) && existsSync(p)) return p;
  } catch {
    /* tenta o fallback */
  }
  // 2) procura fisicamente subindo a partir do cwd (pnpm: symlink em node_modules)
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const cand = path.join(dir, "node_modules", rel);
    if (existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export async function ocrImage(buf: Buffer): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const workerPath = resolveWorkerPath();
  const worker = await createWorker("por+eng", 1, workerPath ? { workerPath } : undefined);
  try {
    const { data } = await worker.recognize(buf);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
