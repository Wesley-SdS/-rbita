import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Carrega o `.env` ANTES de qualquer import que leia process.env (o @orbita/db
 * exige DATABASE_URL no import). O arquivo canônico continua em apps/web/.env,
 * porque o Next só lê de lá; um `.env` na raiz do repo, se existir, vence.
 */
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env"), resolve(process.cwd(), "../web/.env"), resolve(process.cwd(), "../../apps/web/.env")]) {
  // TODOS, em ordem de prioridade, e não só o primeiro: o dotenv não
  // sobrescreve o que já foi definido, então a raiz continua vencendo por
  // variável. Parar no primeiro fazia um `.env` na raiz com só uma linha (a
  // senha da ponte do WhatsApp) apagar o DATABASE_URL do apps/web/.env, e a
  // api não subia (medido em 27/09/2026).
  if (existsSync(p)) loadEnv({ path: p, quiet: true });
}
