import { log } from "../observability/logger";
import { SETTING_DEFS, SETTING_GROUPS, isSettingKey, schemaFor, type SettingKey, type SettingType, type SettingValues } from "./defs";

/**
 * Leitura/escrita de configuração com cache curto por processo.
 *
 * Por que cache com TTL e não invalidação: há dois processos (Next e apps/api)
 * lendo a mesma tabela. Um TTL de segundos garante "mudou na tela, valeu em
 * instantes" sem exigir broker nem restart. O próprio processo que escreve
 * invalida na hora. Falha de banco degrada para os defaults (fail-soft): uma
 * tabela indisponível não pode derrubar o turno do chat.
 */
export interface SettingsBackend {
  loadAll(scope: string): Promise<{ key: string; value: unknown }[]>;
  save(scope: string, key: string, value: unknown): Promise<void>;
  remove(scope: string, key: string): Promise<void>;
}

export interface SettingListItem {
  key: string;
  label: string;
  description: string;
  unit?: string;
  warning?: string;
  type: SettingType;
  value: unknown;
  default: unknown;
  overridden: boolean;
  /** valor escondido para quem não é o dono (ver `redactListing`) */
  hidden?: boolean;
  sensitive?: boolean;
}

export interface SettingsListing {
  groups: { id: string; label: string; settings: SettingListItem[] }[];
}

export interface SettingsStore {
  get<K extends SettingKey>(key: K, scope?: string): Promise<SettingValues[K]>;
  getMany<K extends SettingKey>(keys: readonly K[], scope?: string): Promise<Pick<SettingValues, K>>;
  set<K extends SettingKey>(key: K, value: unknown, scope?: string): Promise<SettingValues[K]>;
  reset(key: SettingKey, scope?: string): Promise<void>;
  /** tudo, resolvido (default ou sobrescrito), para a tela de ajustes */
  list(scope?: string): Promise<SettingsListing>;
  invalidate(): void;
}

export class SettingValidationError extends Error {
  constructor(
    public readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = "SettingValidationError";
  }
}

const GLOBAL = "global";

/** Mensagem em pt-BR por tipo (a do zod vem em inglês e sem a faixa). */
function invalidMessage(t: SettingType): string {
  switch (t.kind) {
    case "number":
      return `Deve ser um número${t.integer ? " inteiro" : ""} entre ${t.min} e ${t.max}`;
    case "boolean":
      return "Deve ser verdadeiro ou falso";
    case "select":
      return `Opção inválida (aceitas: ${t.options.map((o) => o.value).join(", ")})`;
    case "text":
      return t.minLength ? `Texto inválido (entre ${t.minLength} e ${t.maxLength ?? 200} caracteres)` : `Texto inválido (máximo ${t.maxLength ?? 200} caracteres)`;
    case "list":
      return `Lista inválida (até ${t.maxItems ?? 200} itens, cada um com até ${t.itemMaxLength ?? 200} caracteres)`;
  }
}

/**
 * Esconde o valor das chaves sensíveis para quem não é o dono (RV.1). A chave
 * continua listada (a tela mostra que existe), só o conteúdo some. Puro.
 */
export function redactListing(listing: SettingsListing, owner: boolean): SettingsListing {
  if (owner) return listing;
  return {
    groups: listing.groups.map((g) => ({
      ...g,
      settings: g.settings.map((s) => (s.sensitive ? { ...s, value: null, default: null, hidden: true } : s)),
    })),
  };
}

export function createSettingsStore(backend: SettingsBackend, cacheMs = 5000): SettingsStore {
  const cache = new Map<string, { at: number; rows: Map<string, unknown> }>();

  async function rows(scope: string): Promise<Map<string, unknown>> {
    const c = cache.get(scope);
    if (c && Date.now() - c.at < cacheMs) return c.rows;
    let map = new Map<string, unknown>();
    try {
      for (const r of await backend.loadAll(scope)) map.set(r.key, r.value);
    } catch (e) {
      // fail-soft: sem banco, valem os defaults; mantém o cache antigo se houver
      log.warn("settings.load_falhou", { scope, error: e instanceof Error ? e.message : String(e) });
      if (c) map = c.rows;
    }
    cache.set(scope, { at: Date.now(), rows: map });
    return map;
  }

  function resolve<K extends SettingKey>(key: K, raw: unknown): SettingValues[K] {
    const def = SETTING_DEFS[key];
    if (raw === undefined) return def.default as SettingValues[K];
    const parsed = schemaFor(def).safeParse(raw);
    if (parsed.success) return parsed.data as SettingValues[K];
    // valor gravado que não passa mais na faixa (ex.: faixa apertou): ignora com aviso
    log.warn("settings.valor_invalido", { key, raw });
    return def.default as SettingValues[K];
  }

  return {
    async get(key, scope = GLOBAL) {
      const r = await rows(scope);
      return resolve(key, r.get(key));
    },
    async getMany(keys, scope = GLOBAL) {
      const r = await rows(scope);
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = resolve(k, r.get(k));
      return out as Pick<SettingValues, (typeof keys)[number]>;
    },
    async set(key, value, scope = GLOBAL) {
      if (!isSettingKey(key)) throw new SettingValidationError(key, "Configuração desconhecida");
      const def = SETTING_DEFS[key];
      const parsed = schemaFor(def).safeParse(value);
      if (!parsed.success) throw new SettingValidationError(key, invalidMessage(def.type));
      await backend.save(scope, key, parsed.data);
      cache.delete(scope);
      return parsed.data as SettingValues[typeof key];
    },
    async reset(key, scope = GLOBAL) {
      if (!isSettingKey(key)) throw new SettingValidationError(key, "Configuração desconhecida");
      await backend.remove(scope, key);
      cache.delete(scope);
    },
    async list(scope = GLOBAL) {
      const r = await rows(scope);
      const groups = Object.entries(SETTING_GROUPS)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([id, g]) => ({
          id,
          label: g.label,
          settings: (Object.keys(SETTING_DEFS) as SettingKey[])
            .filter((k) => SETTING_DEFS[k].group === id)
            .map((k): SettingListItem => {
              const def = SETTING_DEFS[k];
              const raw = r.get(k);
              return {
                key: k,
                label: def.label,
                description: def.description,
                unit: def.unit,
                warning: def.warning,
                type: def.type,
                value: resolve(k, raw),
                default: def.default,
                overridden: raw !== undefined,
                sensitive: "sensitive" in def ? def.sensitive : undefined,
              };
            }),
        }))
        .filter((g) => g.settings.length);
      return { groups };
    },
    invalidate() {
      cache.clear();
    },
  };
}
