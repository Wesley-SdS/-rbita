import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Carrega o `.env` ANTES de qualquer import que leia process.env (o @orbita/db
 * exige DATABASE_URL no import). O arquivo canônico continua em apps/web/.env,
 * porque o Next só lê de lá; um `.env` na raiz do repo, se existir, vence.
 */
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env"), resolve(process.cwd(), "../web/.env"), resolve(process.cwd(), "../../apps/web/.env")]) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}
