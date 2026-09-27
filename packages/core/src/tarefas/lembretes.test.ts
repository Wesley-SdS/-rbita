import { beforeEach, describe, expect, it, vi } from "vitest";

/** Lembrete com hora: avisa uma vez, fura o silêncio, e diz quando atrasou. */
let devidos: Record<string, unknown>[] = [];
let outroProcessoPegou = false;
const notifyUser = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../routines/run", () => ({ notifyUser }));
vi.mock("../settings", () => ({ settings: { get: async () => "America/Sao_Paulo" } }));
vi.mock("@orbita/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => devidos }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => (outroProcessoPegou ? [] : [{ id: "t1" }]) }) }) }),
  },
}));

const { dispararLembretes, textoDoLembrete } = await import("./lembretes");
const agora = new Date("2026-09-27T18:00:30Z");

beforeEach(() => {
  vi.clearAllMocks();
  outroProcessoPegou = false;
  devidos = [{ id: "t1", userId: "u1", text: "Ligar pro contador", notes: null, lembrarEm: new Date("2026-09-27T18:00:00Z") }];
});

describe("dispararLembretes", () => {
  it("avisa na hora, pelo aviso comum (WhatsApp e push), furando o silêncio", async () => {
    expect(await dispararLembretes(agora)).toBe(1);
    expect(notifyUser).toHaveBeenCalledWith("u1", "Lembrete", "Ligar pro contador", null, { destino: "/app", furaSilencio: true });
  });

  it("outro processo já marcou: não avisa em dobro", async () => {
    outroProcessoPegou = true;
    expect(await dispararLembretes(agora)).toBe(0);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("nada devido", async () => {
    devidos = [];
    expect(await dispararLembretes(agora)).toBe(0);
  });
});

describe("textoDoLembrete", () => {
  it("na hora: só a tarefa (e as anotações)", () => {
    expect(textoDoLembrete({ text: "Pagar IPVA", notes: "boleto no e-mail", lembrarEm: new Date("2026-09-27T18:00:00Z") }, agora, "America/Sao_Paulo")).toBe("Pagar IPVA\nboleto no e-mail");
  });
  it("muito atrasado (a Órbita estava desligada): diz para quando era", () => {
    const t = textoDoLembrete({ text: "Pagar IPVA", notes: null, lembrarEm: new Date("2026-09-27T12:00:00Z") }, agora, "America/Sao_Paulo");
    expect(t).toBe("Pagar IPVA (era para 27/09, 09:00)");
  });
});
