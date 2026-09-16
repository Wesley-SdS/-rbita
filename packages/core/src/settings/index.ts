import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { setting } from "@orbita/db/setting-schema";
import { createSettingsStore, type SettingsBackend, type SettingsStore } from "./store";

export * from "./defs";
export * from "./store";
import "./apply";

/** Backend real: tabela `setting` via Drizzle. */

export const drizzleSettingsBackend: SettingsBackend = {
  async loadAll(scope) {
    return db.select({ key: setting.key, value: setting.value }).from(setting).where(eq(setting.scope, scope));
  },
  async save(scope, key, value) {
    await db
      .insert(setting)
      .values({ key, scope, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [setting.key, setting.scope], set: { value, updatedAt: new Date() } });
  },
  async remove(scope, key) {
    await db.delete(setting).where(and(eq(setting.key, key), eq(setting.scope, scope)));
  },
};

// O TTL do cache é constante de bootstrap: não faz sentido configurar pela tela
// o tempo que a própria tela leva para valer. Ainda assim é sobrescrevível por env.
const CACHE_MS = Number(process.env.SETTINGS_CACHE_MS ?? 5000);

/** Instância padrão, compartilhada por todo o processo. */
export const settings: SettingsStore = createSettingsStore(drizzleSettingsBackend, CACHE_MS);
