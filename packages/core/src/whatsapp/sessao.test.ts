import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saúde e ciclo de vida da sessão. O que fica travado:
 *   - um soluço da ponte não é queda (N conferências seguidas);
 *   - queda da PONTE não conta como reconexão do número;
 *   - desconectar que falhou na ponte NÃO vira "desconectado" na tela;
 *   - mudou o endereço do webhook em Ajustes: a saúde reaponta sozinha;
 *   - endereço do webhook fora de casa é recusado.
 */

type Linha = { id: string; userId: string; deviceId: string; webhookSegredoEnc: string; jid: string | null; status: string; pareadoEm: Date | null; reconexoes: number };
let linha: Linha;
let cfg: Record<string, unknown>;
const sets: Record<string, unknown>[] = [];

class PonteError extends Error {
  constructor(m: string, public motivo: string) {
    super(m);
  }
}
const estado = vi.fn();
const desconectar = vi.fn(async () => undefined);
const apontarWebhook = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("./gowa/client", () => ({ PonteError, estado, desconectar, apontarWebhook }));
vi.mock("../crypto", () => ({ decryptSecret: () => "segredo", encryptSecret: () => "enc" }));
const emit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../events/index", () => ({ events: { emit } }));
vi.mock("../settings", () => ({ settings: { get: async (k: string) => cfg[k] } }));
vi.mock("@orbita/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [linha] }) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          sets.push(v);
          Object.assign(linha, v);
        },
      }),
    }),
  },
}));

const s = await import("./sessao");
const conectado = { conectado: true, logado: true, jid: "5511900000000:3@s.whatsapp.net" };

beforeEach(() => {
  vi.clearAllMocks();
  sets.length = 0;
  cfg = { "whatsapp.saudeFalhasParaCair": 3, "whatsapp.webhookBase": "http://host.docker.internal:3010" };
  linha = { id: "s1", userId: "u1", deviceId: "dev-" + Math.random(), webhookSegredoEnc: "x", jid: "5511900000000@s.whatsapp.net", status: "conectado", pareadoEm: new Date(), reconexoes: 0 };
});

describe("conferirSaude", () => {
  it("um soluço não derruba: só a N-ésima falha seguida vira queda", async () => {
    estado.mockRejectedValue(new PonteError("fora", "fora_do_ar"));
    expect(await s.conferirSaude("u1")).toBe("conectado");
    expect(await s.conferirSaude("u1")).toBe("conectado");
    expect(emit).not.toHaveBeenCalled();
    expect(await s.conferirSaude("u1")).toBe("desconectado");
    expect(emit).toHaveBeenCalledWith("whatsapp.sessao_caiu", { motivo: "ponte_fora_do_ar" }, { userId: "u1" });
    estado.mockReset();
  });

  it("voltar depois de queda da PONTE não conta reconexão; queda do número conta", async () => {
    estado.mockRejectedValue(new PonteError("fora", "fora_do_ar"));
    for (let i = 0; i < 3; i++) await s.conferirSaude("u1");
    estado.mockResolvedValue(conectado);
    expect(await s.conferirSaude("u1")).toBe("conectado");
    expect(linha.reconexoes).toBe(0);
    expect(emit).toHaveBeenLastCalledWith("whatsapp.sessao_voltou", { jid: "5511900000000@s.whatsapp.net" }, { userId: "u1" });

    estado.mockResolvedValue({ conectado: false, logado: true, jid: null });
    for (let i = 0; i < 3; i++) await s.conferirSaude("u1");
    estado.mockResolvedValue(conectado);
    await s.conferirSaude("u1");
    expect(linha.reconexoes).toBe(1);
    estado.mockReset();
  });

  it("sem mudança não grava nada", async () => {
    estado.mockResolvedValue(conectado);
    await s.conferirSaude("u1");
    expect(sets.filter((x) => "status" in x)).toHaveLength(0);
    estado.mockReset();
  });

  it("reaponta o webhook uma vez, e de novo quando o endereço muda em Ajustes", async () => {
    estado.mockResolvedValue(conectado);
    await s.conferirSaude("u1");
    await s.conferirSaude("u1");
    expect(apontarWebhook).toHaveBeenCalledTimes(1);
    cfg["whatsapp.webhookBase"] = "http://127.0.0.1:3010";
    await s.conferirSaude("u1");
    expect(apontarWebhook).toHaveBeenCalledTimes(2);
    expect(apontarWebhook).toHaveBeenLastCalledWith(linha.deviceId, `http://127.0.0.1:3010/api/whatsapp/webhook/${linha.deviceId}`, "segredo");
    estado.mockReset();
  });
});

describe("endereço do webhook", () => {
  it("fora de casa é recusado: toda mensagem de terceiro iria para lá", async () => {
    cfg["whatsapp.webhookBase"] = "https://exemplo.com";
    await expect(s.urlDoWebhook("dev1")).rejects.toMatchObject({ motivo: "nao_local" });
  });
});

describe("desconectarSessao", () => {
  it("logout que falhou na ponte sobe o erro e NÃO marca desconectado", async () => {
    desconectar.mockRejectedValueOnce(new PonteError("fora", "fora_do_ar"));
    await expect(s.desconectarSessao("u1")).rejects.toThrow("fora");
    expect(linha.status).toBe("conectado");
  });

  it("'já não estava pareado' conta como sucesso", async () => {
    desconectar.mockRejectedValueOnce(new PonteError("não pareado", "sem_sessao"));
    await s.desconectarSessao("u1");
    expect(linha.status).toBe("desconectado");
    expect(emit).toHaveBeenCalledWith("whatsapp.sessao_caiu", { motivo: "desconectado_pelo_dono" }, { userId: "u1" });
  });
});
