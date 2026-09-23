import { defineConfig } from "vitest/config";
import path from "node:path";

// Raiz no monorepo: um único `vitest run` (de apps/web) cobre o web, os packages
// e o apps/api. A lógica pura mora nos packages depois da extração; o web só
// guarda o que depende de browser (engine, speech).
export default defineConfig({
  root: path.resolve(__dirname, "../.."),
  test: {
    environment: "node",
    // Import de módulo pesado (AI SDK, drizzle) com a CPU saturada por modelo local
    // passava de 20 s e derrubava a suíte por carga, não por bug.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // `apps/mobile/lib` entra aqui de propósito, mesmo estando fora do
    // workspace pnpm: a lógica PURA do app (o leitor de NDJSON, o corte de
    // fala) é a que quebra em silêncio, e ficava sem rede de segurança. Só
    // `lib`, porque as telas importam React Native e não rodam em node.
    include: [
      "apps/web/src/**/*.test.ts",
      "apps/api/src/**/*.test.ts",
      "apps/mobile/lib/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
    ],
    // O client do @orbita/db exige DATABASE_URL no import (e só conecta no
    // primeiro uso). Um valor de teste permite importar módulos que dependem do
    // banco sem tocar nele; testes que tocam no banco usam a URL real do .env.
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "postgres://orbita:orbita@localhost:5433/orbita" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
