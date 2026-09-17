import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gesto vira EVENTO, nunca ação (CLAUDE.md §5.4.2). Duas garantias que só
 * existem neste caminho e que este arquivo cobre com o banco e a percepção
 * dublados:
 *
 *   1. zero hardcode (§5.6): o vocabulário de gestos é a lista `vision.gestures`
 *      do dono, então gesto fora dela não vira evento nem trilha;
 *   2. gesto só ganha dono quando o rosto foi IDENTIFICADO. "Provavelmente" e
 *      desconhecido viram gesto sem pessoa, porque a regra do dono pode fazer
 *      coisa diferente para cada um (§5.4.2, identidade nunca afirma sem
 *      confiança).
 */

const fake = vi.hoisted(() => {
  type Consulta = { op: string; tabela: unknown; calls: Record<string, unknown[]> };
  const consultas: Consulta[] = [];
  const fila: { op: string; tabela: unknown; rows: unknown[] }[] = [];
  const metodos = ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "values", "set", "returning"];

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
  };

  return {
    db,
    consultas,
    fila,
    /** o que a percepção local "viu" no keyframe */
    vistos: [] as { gesto: string; confianca: number; mao: string }[],
    /** `vision.gestures`: vazio = o dono não restringiu nada */
    habilitados: [] as string[],
    chamadasPercepcao: [] as { mime: string; bytes: number }[],
    emitidos: [] as { tipo: string; payload: Record<string, unknown> }[],
    reset() {
      consultas.length = 0;
      fila.length = 0;
      fake.vistos.length = 0;
      fake.habilitados.length = 0;
      fake.chamadasPercepcao.length = 0;
      fake.emitidos.length = 0;
    },
    responder(tabela: unknown, rows: unknown[], op = "select") {
      fila.push({ op, tabela, rows });
    },
    trilhas() {
      return consultas.filter((q) => q.op === "insert").map((q) => q.calls.values?.[0] as Record<string, unknown>);
    },
  };
});

vi.mock("@orbita/db", () => ({ db: fake.db }));
vi.mock("../settings", () => ({ settings: { get: async () => fake.habilitados, getMany: async () => ({}) } }));
vi.mock("../events/index", () => ({
  events: {
    emit: async (tipo: string, payload: Record<string, unknown>) => {
      fake.emitidos.push({ tipo, payload });
    },
  },
}));
vi.mock("../perception/client", () => ({
  detectGestures: async (bytes: Uint8Array, mime: string) => {
    fake.chamadasPercepcao.push({ mime, bytes: bytes.length });
    return { ms: 1, vocabulario: ["joia", "palma"], gestos: fake.vistos };
  },
}));

import { cameraEvent } from "@orbita/db/camera-schema";
import { identityAudit } from "@orbita/db/identity-schema";
import { detectGestureForEvent } from "./gesture";

const evento = (over: Record<string, unknown> = {}) => ({
  id: "ev1",
  userId: "dono-1",
  snapshot: "data:image/png;base64,QUJD",
  personId: "p1",
  outcome: "identificado",
  cameraId: "cam1",
  cameraName: "Entrada",
  roomId: "r1",
  roomName: "Sala",
  detecta: true,
  ...over,
});

beforeEach(() => fake.reset());

describe("só o gesto que o dono habilitou vira evento", () => {
  it("gesto fora da lista não vira evento nem trilha", async () => {
    fake.habilitados.push("joia", "palma");
    fake.vistos.push({ gesto: "dedo_medio", confianca: 0.9, mao: "direita" });
    fake.responder(cameraEvent, [evento()]);

    expect(await detectGestureForEvent("ev1")).toEqual([]);
    expect(fake.emitidos).toEqual([]);
    expect(fake.trilhas()).toEqual([]);
  });

  it("da lista, passa; e o que não está some do meio dos que passam", async () => {
    fake.habilitados.push("joia");
    fake.vistos.push({ gesto: "dedo_medio", confianca: 0.9, mao: "direita" }, { gesto: "joia", confianca: 0.8, mao: "esquerda" });
    fake.responder(cameraEvent, [evento()]);

    const r = await detectGestureForEvent("ev1");
    expect(r.map((g) => g.gesto)).toEqual(["joia"]);
    expect(fake.emitidos).toHaveLength(1);
    expect(fake.emitidos[0]).toMatchObject({ tipo: "identity.gesture", payload: { gesto: "joia", comodo: "Sala", camera: "Entrada" } });
  });

  it("lista vazia não restringe nada: quem decide é o dono (§5.6)", async () => {
    fake.vistos.push({ gesto: "qualquer_coisa", confianca: 0.5, mao: "direita" });
    fake.responder(cameraEvent, [evento()]);

    expect((await detectGestureForEvent("ev1")).map((g) => g.gesto)).toEqual(["qualquer_coisa"]);
  });
});

describe("gesto só tem dono quando o rosto foi identificado", () => {
  const comOutcome = async (outcome: string) => {
    fake.reset();
    fake.vistos.push({ gesto: "joia", confianca: 0.9, mao: "direita" });
    fake.responder(cameraEvent, [evento({ outcome, personId: outcome === "desconhecido" ? null : "p1" })]);
    return detectGestureForEvent("ev1");
  };

  it("identificado: o gesto é dela", async () => {
    const r = await comOutcome("identificado");
    expect(r[0]?.personId).toBe("p1");
    expect(fake.emitidos[0]?.payload.personId).toBe("p1");
    expect(fake.trilhas()[0]).toMatchObject({ action: "gesto", personId: "p1", outcome: "joia", confidence: 0.9 });
  });

  it("provavelmente: gesto sem dono, não vira gesto da pessoa provável", async () => {
    const r = await comOutcome("provavel");
    expect(r[0]?.personId).toBeNull();
    expect(fake.emitidos[0]?.payload.personId).toBeNull();
    expect(fake.trilhas()[0]).toMatchObject({ personId: null });
  });

  it("desconhecido: gesto sem dono", async () => {
    expect((await comOutcome("desconhecido"))[0]?.personId).toBeNull();
  });

  it("evento sem identificação nenhuma: gesto anônimo, e ainda assim auditado", async () => {
    fake.vistos.push({ gesto: "palma", confianca: 0.7, mao: "direita" });
    fake.responder(cameraEvent, [evento({ outcome: null, personId: null })]);

    const r = await detectGestureForEvent("ev1");
    expect(r[0]).toMatchObject({ gesto: "palma", personId: null, roomId: "r1" });
    expect(fake.trilhas()[0]).toMatchObject({ source: "camera", kind: "gesto" });
  });
});

describe("não gasta CPU da percepção à toa", () => {
  it("câmera com gestos desligados nem manda o keyframe", async () => {
    fake.responder(cameraEvent, [evento({ detecta: false })]);

    expect(await detectGestureForEvent("ev1")).toEqual([]);
    expect(fake.chamadasPercepcao).toEqual([]);
  });

  it("evento sem snapshot nem manda o keyframe", async () => {
    fake.responder(cameraEvent, [evento({ snapshot: null })]);

    expect(await detectGestureForEvent("ev1")).toEqual([]);
    expect(fake.chamadasPercepcao).toEqual([]);
  });

  it("evento que não existe devolve lista vazia", async () => {
    expect(await detectGestureForEvent("sumiu")).toEqual([]);
    expect(fake.chamadasPercepcao).toEqual([]);
  });

  it("manda o tipo da imagem que veio no snapshot, não um chute", async () => {
    fake.vistos.push({ gesto: "joia", confianca: 0.9, mao: "direita" });
    fake.responder(cameraEvent, [evento()]);

    await detectGestureForEvent("ev1");
    // "QUJD" é "ABC" em base64: o corpo enviado é o binário, não o data URL
    expect(fake.chamadasPercepcao).toEqual([{ mime: "image/png", bytes: 3 }]);
  });
});

it("a trilha do gesto aponta o evento de câmera que o gerou", async () => {
  fake.vistos.push({ gesto: "joia", confianca: 0.9, mao: "direita" });
  fake.responder(cameraEvent, [evento()]);

  await detectGestureForEvent("ev1");
  expect(fake.trilhas()[0]).toMatchObject({ userId: "dono-1", detail: { camera: "Entrada", comodo: "Sala", evento: "ev1" } });
  expect(fake.consultas.some((q) => q.op === "insert" && q.tabela === identityAudit)).toBe(true);
});
