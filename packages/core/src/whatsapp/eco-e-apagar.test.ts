import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O eco (a Órbita não responde a si mesma) e o apagar da conta (o que mora
 * fora do banco também some).
 */

let pendente: { id: string } | null = null;
let comMidia: { caminho: string }[] = [];
let aindaUsados: string[] = [];
const atualizados: Record<string, unknown>[] = [];

vi.mock("@orbita/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const q = { orderBy: () => q, limit: async () => (pendente ? [pendente] : []), then: (r: (v: unknown) => unknown) => r(aindaUsados.map((c) => ({ caminho: c }))) };
          return q;
        },
      }),
    }),
    selectDistinct: () => ({ from: () => ({ where: async () => comMidia }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void atualizados.push(v) }) }),
  },
}));
const desconectar = vi.fn(async (..._a: unknown[]) => undefined);
const removerDispositivo = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("./gowa/client", () => ({ desconectar, removerDispositivo }));
let sessao: { deviceId: string } | null = { deviceId: "dev1" };
vi.mock("./sessao", () => ({ sessaoDe: async () => sessao }));
const apagarMidias = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("./midia", () => ({ apagarMidias }));

const store = await import("./store");
const apagar = await import("./apagar");

beforeEach(() => {
  vi.clearAllMocks();
  pendente = null;
  comMidia = [];
  aindaUsados = [];
  atualizados.length = 0;
  sessao = { deviceId: "dev1" };
});

describe("casarEco", () => {
  it("achou a saída pendente: grava o id nela e diz que era eco", async () => {
    pendente = { id: "linha1" };
    expect(await store.casarEco("u1", "5511@s.whatsapp.net", "texto", "chego às 8", "WAID")).toBe(true);
    expect(atualizados).toEqual([{ externalId: "WAID" }]);
  });

  it("nenhuma saída pendente casa: não é eco (é o dono escrevendo)", async () => {
    expect(await store.casarEco("u1", "5511@s.whatsapp.net", "texto", "outra coisa", "WAID")).toBe(false);
    expect(atualizados).toEqual([]);
  });
});

describe("apagar a conta", () => {
  it("antes: tira o número da ponte e junta a mídia; depois: apaga só o que ninguém mais usa", async () => {
    comMidia = [{ caminho: "aa/1.ogg" }, { caminho: "bb/2.jpg" }];
    const caminhos = await apagar.antesDeApagarConta("u1");
    expect(desconectar).toHaveBeenCalledWith("dev1");
    expect(removerDispositivo).toHaveBeenCalledWith("dev1");
    expect(caminhos).toEqual(["aa/1.ogg", "bb/2.jpg"]);
    aindaUsados = ["bb/2.jpg"]; // o mesmo arquivo, deduplicado, é de outra mensagem
    await apagar.depoisDeApagarConta(caminhos);
    expect(apagarMidias).toHaveBeenCalledWith(["aa/1.ogg"]);
  });

  it("ponte fora do ar não impede apagar a conta", async () => {
    desconectar.mockRejectedValueOnce(new Error("fora"));
    removerDispositivo.mockRejectedValueOnce(new Error("fora"));
    await expect(apagar.antesDeApagarConta("u1")).resolves.toEqual([]);
  });

  it("sem WhatsApp: nada na ponte", async () => {
    sessao = null;
    await apagar.antesDeApagarConta("u1");
    expect(desconectar).not.toHaveBeenCalled();
  });
});
