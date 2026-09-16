import { defineConfig } from "vitest/config";
import path from "node:path";

// Raiz no monorepo: um único `vitest run` (de apps/web) cobre o web, os packages
// e o apps/api. A lógica pura mora nos packages depois da extração; o web só
// guarda o que depende de browser (engine, speech).
export default defineConfig({
  root: path.resolve(__dirname, "../.."),
  test: {
    environment: "node",
    include: ["apps/web/src/**/*.test.ts", "apps/api/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    // O client do @orbita/db exige DATABASE_URL no import (e só conecta no
    // primeiro uso). Um valor de teste permite importar módulos que dependem do
    // banco sem tocar nele; testes que tocam no banco usam a URL real do .env.
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "postgres://orbita:orbita@localhost:5433/orbita" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
