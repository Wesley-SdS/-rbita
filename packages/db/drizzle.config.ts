import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// O `.env` canônico continua em apps/web (o Next só lê de lá). Os demais
// processos (drizzle-kit, apps/api) apontam para o mesmo arquivo, para não
// haver dois lugares de segredo. Um `.env` na raiz, se existir, tem prioridade.
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env"), resolve(process.cwd(), "../../apps/web/.env")]) {
  if (existsSync(p)) { loadEnv({ path: p }); break; }
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
