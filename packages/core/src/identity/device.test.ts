import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Aqui" e "onde falar com ela" (B5.3/B5.4, Onda 12). Dois contratos que só
 * aparecem no encadeamento com banco, e que este arquivo cobre com um dublê de
 * cadeia Drizzle (a suíte roda numa máquina saturada, subir Postgres é caro):
 *
 *   1. presença VELHA não escolhe aparelho: falar no cômodo onde a pessoa
 *      estava de manhã é pior que falar em todos (decisão 9.3);
 *   2. aparelho e cômodo são sempre da conta dona, nunca de outra.
 */

const fake = vi.hoisted(() => {
  type Consulta = { op: string; tabela: unknown; calls: Record<string, unknown[]> };
  const consultas: Consulta[] = [];
  const fila: { op: string; tabela: unknown; rows: unknown[] }[] = [];
  const metodos = ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "values", "set", "returning", "onConflictDoUpdate"];

  function cadeia(op: string, tabela?: unknown) {
    const q: Consulta = { op, tabela, calls: {} };
    consultas.push(q);
    const p: Record<string, unknown> = {
      then: (ok: (v: unknown[]) => void) => {
        const i = fila.findIndex((f) => f.tabela === q.tabela && f.op === q.op);
        ok(i >= 0 ? fila.splice(i, 1)[0]!.rows : []);
      },
    };
    for (const m of metodos) {
      p[m] = (...args: unknown[]) => {
        q.calls[m] = args;
        if (m === "from") q.tabela = args[0];
        return p;
      };
    }
    return p;
  }

  const db = {
    select: () => cadeia("select"),
    insert: (t: unknown) => cadeia("insert", t),
    update: (t: unknown) => cadeia("update", t),
    delete: (t: unknown) => cadeia("delete", t),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  return {
    db,
    consultas,
    fila,
    reset() {
      consultas.length = 0;
      fila.length = 0;
    },
    responder(tabela: unknown, rows: unknown[], op = "select") {
      fila.push({ op, tabela, rows });
    },
    achar(op: string, tabela: unknown) {
      return consultas.find((q) => q.op === op && q.tabela === tabela);
    },
  };
});

vi.mock("@orbita/db", () => ({ db: fake.db }));
vi.mock("../settings", () => ({
  settings: {
    get: async () => "",
    getMany: async () => ({ "identity.presenceFreshMinutes": 5, "identity.presenceRecentMinutes": 60 }),
  },
}));

import { device } from "@orbita/db/device-schema";
import { room } from "@orbita/db/home-schema";
import { personPresence } from "@orbita/db/presence-schema";
import { deviceForPerson, registerDevice, resolveOrigin, updateDevice } from "./device";

const DONO = "dono-1";
const atras = (min: number) => new Date(Date.now() - min * 60_000);

/**
 * Valores que foram para o WHERE. É o único jeito de provar o filtro por conta
 * sem banco real: o dublê responde o que mandarem, o filtro está na consulta.
 */
const paramsDo = (n: unknown, vistos = new Set<unknown>()): unknown[] => {
  if (!n || typeof n !== "object" || vistos.has(n)) return [];
  vistos.add(n);
  if (n.constructor?.name === "Param") return [(n as { value: unknown }).value];
  const chunks = (n as { queryChunks?: unknown[] }).queryChunks;
  return Array.isArray(chunks) ? chunks.flatMap((c) => paramsDo(c, vistos)) : [];
};
const filtroDe = (op: string, tabela: unknown) => paramsDo(fake.achar(op, tabela)?.calls.where?.[0]);

beforeEach(() => fake.reset());

describe("a voz segue a pessoa só quando a presença é de agora", () => {
  it("vista agora: usa o aparelho do cômodo onde ela está", async () => {
    fake.responder(personPresence, [{ roomId: "r1", seenAt: atras(1) }]);
    fake.responder(device, [{ id: "d1", name: "Eco da sala" }]);

    expect(await deviceForPerson(DONO, "p1")).toEqual({ id: "d1", name: "Eco da sala", roomId: "r1" });
  });

  it("presença apenas RECENTE não escolhe aparelho, e nem procura um", async () => {
    fake.responder(personPresence, [{ roomId: "r1", seenAt: atras(10) }]);
    fake.responder(device, [{ id: "d1", name: "Eco da sala" }]);

    expect(await deviceForPerson(DONO, "p1")).toBeNull();
    // o corte é antes da busca: "visto por último" nunca vira "está aqui"
    expect(fake.achar("select", device)).toBeUndefined();
  });

  it("presença antiga também não", async () => {
    fake.responder(personPresence, [{ roomId: "r1", seenAt: atras(180) }]);

    expect(await deviceForPerson(DONO, "p1")).toBeNull();
    expect(fake.achar("select", device)).toBeUndefined();
  });

  it("sem presença nenhuma, ou sem cômodo, devolve null", async () => {
    expect(await deviceForPerson(DONO, "p1")).toBeNull();
    fake.reset();
    fake.responder(personPresence, [{ roomId: null, seenAt: atras(1) }]);
    expect(await deviceForPerson(DONO, "p1")).toBeNull();
  });

  it("cômodo sem nenhum aparelho cadastrado devolve null (quem chamou avisa em todo lugar)", async () => {
    fake.responder(personPresence, [{ roomId: "r1", seenAt: atras(1) }]);

    expect(await deviceForPerson(DONO, "p1")).toBeNull();
    expect(filtroDe("select", personPresence)).toContain(DONO);
  });
});

describe("aparelho e cômodo são sempre da conta dona", () => {
  it("cadastrar num cômodo que não é desta conta não cadastra nada", async () => {
    await expect(registerDevice(DONO, { name: "Tablet", kind: "navegador", roomId: "r-de-outro" })).rejects.toMatchObject({ status: 404 });
    expect(fake.achar("insert", device)).toBeUndefined();
    // a consulta do cômodo leva o dono junto: é ela que decide se existe "para mim"
    expect(filtroDe("select", room)).toEqual(expect.arrayContaining(["r-de-outro", DONO]));
  });

  it("cadastra preso à conta dona", async () => {
    fake.responder(room, [{ id: "r1" }]);
    fake.responder(device, [{ id: "d9" }], "insert");

    expect(await registerDevice(DONO, { name: "Eco da sala", kind: "satelite", roomId: "r1" })).toEqual({ id: "d9" });
    expect(fake.achar("insert", device)?.calls.values?.[0]).toMatchObject({ userId: DONO, name: "Eco da sala", kind: "satelite", roomId: "r1" });
  });

  it("editar aparelho de outra conta não encontra nada", async () => {
    await expect(updateDevice(DONO, "d-de-outro", { name: "Meu" })).rejects.toMatchObject({ status: 404 });
    expect(filtroDe("update", device)).toEqual(expect.arrayContaining(["d-de-outro", DONO]));
  });

  it("editar mandando para cômodo de outra conta não chega a atualizar", async () => {
    await expect(updateDevice(DONO, "d1", { roomId: "r-de-outro" })).rejects.toThrow(/Cômodo não encontrado/);
    expect(fake.achar("update", device)).toBeUndefined();
  });

  it("edição válida aplica só os campos enviados", async () => {
    fake.responder(room, [{ id: "r1" }]);
    fake.responder(device, [{ id: "d1" }], "update");

    await updateDevice(DONO, "d1", { roomId: "r1" });
    expect(fake.achar("update", device)?.calls.set?.[0]).toEqual({ roomId: "r1" });
  });
});

describe("de onde veio o pedido", () => {
  it("sem id de aparelho não há origem, nem consulta", async () => {
    expect(await resolveOrigin(DONO, null)).toBeNull();
    expect(await resolveOrigin(DONO, undefined)).toBeNull();
    expect(fake.consultas).toHaveLength(0);
  });

  it("aparelho desconhecido não vira origem nem marca uso", async () => {
    expect(await resolveOrigin(DONO, "d-de-outro")).toBeNull();
    expect(fake.achar("update", device)).toBeUndefined();
  });

  it("devolve o cômodo do aparelho e marca que ele está em uso", async () => {
    fake.responder(device, [{ id: "d1", name: "Navegador", roomId: "r1", roomName: "Sala" }]);

    expect(await resolveOrigin(DONO, "d1")).toEqual({ deviceId: "d1", name: "Navegador", roomId: "r1", roomName: "Sala" });
    expect(fake.achar("update", device)?.calls.set?.[0]).toMatchObject({ lastSeenAt: expect.any(Date) });
  });

  it("aparelho sem cômodo devolve origem sem cômodo, não adivinha", async () => {
    fake.responder(device, [{ id: "d1", name: "Celular", roomId: null, roomName: null }]);

    expect(await resolveOrigin(DONO, "d1")).toMatchObject({ roomId: null, roomName: null });
  });
});
