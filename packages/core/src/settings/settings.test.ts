import { describe, it, expect, vi } from "vitest";
import { createSettingsStore, redactListing, SettingValidationError, type SettingsBackend } from "./store";
import { SETTING_DEFS, schemaFor, isSettingKey } from "./defs";

function memBackend(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const backend: SettingsBackend & { loads: number } = {
    loads: 0,
    async loadAll() {
      this.loads++;
      return [...data].map(([key, value]) => ({ key, value }));
    },
    async save(_s, key, value) {
      data.set(key, value);
    },
    async remove(_s, key) {
      data.delete(key);
    },
  };
  return { backend, data };
}

describe("settings: definições", () => {
  it("todo default passa no próprio schema (senão o app sobe inválido)", () => {
    for (const [key, def] of Object.entries(SETTING_DEFS)) {
      const r = schemaFor(def).safeParse(def.default);
      expect(r.success, `default inválido em ${key}`).toBe(true);
    }
  });
  it("reconhece chaves", () => {
    expect(isSettingKey("chat.historyWindow")).toBe(true);
    expect(isSettingKey("nao.existe")).toBe(false);
  });
});

describe("settings: store", () => {
  it("devolve o default quando não há linha no banco", async () => {
    const { backend } = memBackend();
    const s = createSettingsStore(backend, 1000);
    expect(await s.get("chat.historyWindow")).toBe(24);
    expect(await s.get("auth.signupMode")).toBe("auto");
  });

  it("devolve o valor sobrescrito e marca overridden na listagem", async () => {
    const { backend } = memBackend({ "chat.historyWindow": 40 });
    const s = createSettingsStore(backend, 1000);
    expect(await s.get("chat.historyWindow")).toBe(40);
    const l = await s.list();
    const item = l.groups.flatMap((g) => g.settings).find((x) => x.key === "chat.historyWindow")!;
    expect(item.overridden).toBe(true);
    expect(item.value).toBe(40);
    expect(item.default).toBe(24);
  });

  it("set valida tipo e faixa; rejeita fora da faixa e chave desconhecida", async () => {
    const { backend, data } = memBackend();
    const s = createSettingsStore(backend, 1000);
    await expect(s.set("chat.historyWindow", 999)).rejects.toBeInstanceOf(SettingValidationError);
    await expect(s.set("chat.historyWindow", "24")).rejects.toBeInstanceOf(SettingValidationError);
    await expect(s.set("auth.signupMode", "qualquer")).rejects.toBeInstanceOf(SettingValidationError);
    await expect(s.set("nao.existe" as never, 1)).rejects.toBeInstanceOf(SettingValidationError);
    expect(data.size).toBe(0);
    expect(await s.set("chat.historyWindow", 48)).toBe(48);
    expect(await s.get("chat.historyWindow")).toBe(48);
  });

  it("valor gravado que não passa mais na faixa cai para o default (fail-soft)", async () => {
    const { backend } = memBackend({ "chat.maxSteps": 500 });
    const s = createSettingsStore(backend, 1000);
    expect(await s.get("chat.maxSteps")).toBe(12);
  });

  it("cacheia leituras dentro do TTL e invalida ao escrever", async () => {
    const { backend } = memBackend();
    const s = createSettingsStore(backend, 60_000);
    await s.get("chat.historyWindow");
    await s.getMany(["chat.maxSteps", "rag.topK"]);
    expect(backend.loads).toBe(1);
    await s.set("rag.topK", 6);
    expect(await s.get("rag.topK")).toBe(6);
    expect(backend.loads).toBe(2);
    await s.reset("rag.topK");
    expect(await s.get("rag.topK")).toBe(4);
  });

  it("falha do banco não derruba: usa defaults e avisa", async () => {
    const backend: SettingsBackend = {
      loadAll: vi.fn().mockRejectedValue(new Error("db fora")),
      save: vi.fn(),
      remove: vi.fn(),
    };
    const s = createSettingsStore(backend, 1000);
    expect(await s.get("chat.ragTimeoutMs")).toBe(3500);
  });
});

describe("settings: quem não é o dono (RV.1)", () => {
  it("chave sensível aparece sem valor nem default", async () => {
    const { backend } = memBackend({ "auth.allowedEmails": ["anna@casa.local"] });
    const s = createSettingsStore(backend, 1000);
    const l = redactListing(await s.list(), false);
    const itens = l.groups.flatMap((g) => g.settings);
    const emails = itens.find((x) => x.key === "auth.allowedEmails")!;
    expect(emails).toMatchObject({ hidden: true, value: null, default: null });
    expect(JSON.stringify(l)).not.toContain("anna@casa.local");
    // o resto continua legível
    expect(itens.find((x) => x.key === "chat.historyWindow")!.value).toBe(24);
  });

  it("o dono vê tudo", async () => {
    const { backend } = memBackend({ "auth.allowedEmails": ["anna@casa.local"] });
    const s = createSettingsStore(backend, 1000);
    const l = redactListing(await s.list(), true);
    expect(l.groups.flatMap((g) => g.settings).find((x) => x.key === "auth.allowedEmails")!.value).toEqual(["anna@casa.local"]);
  });
});
