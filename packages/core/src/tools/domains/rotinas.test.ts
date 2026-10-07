import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rotinas com horário e o bom dia (CLAUDE.md §5.7). Nasceu de um pedido pela
 * voz que virou só uma MEMÓRIA (06/10/2026). Travado: criar rotina grava uma
 * regra com horário de verdade, o bom dia muda só o que foi pedido, quem não é
 * o dono não mexe, e a lista mostra o que está agendado.
 */

const inseridas: Record<string, unknown>[] = [];
const ajustes = new Map<string, unknown>();
let dono = true;
let regras: Record<string, unknown>[] = [];
let atualizacoes: Record<string, unknown>[] = [];

vi.mock("@orbita/db", () => {
  const encadeado = (resultado: () => unknown) => {
    const q: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit"]) q[k] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok);
    return q;
  };
  return {
    db: {
      insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: async () => { inseridas.push(v); return [{ id: "r1" }]; } }) }),
      select: () => encadeado(() => regras),
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { atualizacoes.push(v); } }) }),
    },
  };
});
vi.mock("../../owner", () => ({ isOwner: async () => dono }));
vi.mock("../../settings", () => ({
  settings: {
    set: async (k: string, v: unknown) => { ajustes.set(k, v); },
    getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, ajustes.get(k) ?? (k === "casa.trabalhoPorDia" ? [] : k === "whatsapp.briefingDias" ? "todos" : k === "whatsapp.briefingHorario" ? "07:00" : true)])),
  },
}));

const { toToolSet, getTool } = await import("../registry");
const { cronDoHorario, horarioLegivel } = await import("./rotinas");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const gate = { enqueue: async () => ({ id: "a" }) } as unknown as Parameters<typeof toToolSet>[2];
const executar = (nome: string, input: unknown = {}) => (toToolSet([getTool(nome)!], ctx, gate)[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: "c", messages: [] }) as Promise<Record<string, unknown>>;

beforeEach(() => {
  inseridas.length = 0;
  ajustes.clear();
  atualizacoes = [];
  regras = [];
  dono = true;
});

describe("horário de rotina", () => {
  it("vira cron e volta legível", () => {
    expect(cronDoHorario("07:00", "todos")).toBe("0 7 * * *");
    expect(cronDoHorario("7:30", "uteis")).toBe("30 7 * * 1-5");
    expect(cronDoHorario("18:05", ["qui", "ter", "ter"])).toBe("5 18 * * 2,4");
    expect(horarioLegivel("0 7 * * *")).toBe("às 07:00, todo dia");
    expect(horarioLegivel("5 18 * * 2,4")).toBe("às 18:05, ter e qui");
    expect(horarioLegivel("30 7 * * 1-5")).toBe("às 07:30, de segunda a sexta");
  });
});

describe("tools de rotina", () => {
  it("criar_rotina grava uma regra com horário de verdade, e diz quando", async () => {
    const r = await executar("criar_rotina", { nome: "Remédio", horario: "21:00", dias: "todos", pedido: "Lembre o dono de tomar o remédio." });
    expect(inseridas[0]).toMatchObject({ userId: "u1", name: "Remédio", enabled: true, trigger: { kind: "cron", expr: "0 21 * * *" }, actions: [{ kind: "prompt", prompt: "Lembre o dono de tomar o remédio." }] });
    expect(r).toMatchObject({ criada: true, quando: "às 21:00, todo dia" });
  });

  it("configurar_bom_dia muda só o que foi pedido, inclusive o trabalho de cada dia", async () => {
    const r = await executar("configurar_bom_dia", { horario: "7:00", em_audio: true, trabalho_por_dia: [" ter, qui: Companhia de Estágios", "seg, qua, sex: Adalink"] });
    expect(Object.fromEntries(ajustes)).toEqual({ "whatsapp.briefingHorario": "07:00", "whatsapp.briefingAudio": true, "casa.trabalhoPorDia": ["ter, qui: Companhia de Estágios", "seg, qua, sex: Adalink"] });
    expect(String(r.mensagem)).toBe("Bom dia configurado: às 07:00, em áudio, com o trabalho de cada dia.");
    expect((await executar("configurar_bom_dia", {})).erro).toBeTruthy();
  });

  it("quem não é o dono não cria nem configura", async () => {
    dono = false;
    expect((await executar("criar_rotina", { nome: "X", horario: "08:00", dias: "todos", pedido: "algo útil" })).erro).toContain("Só o dono");
    expect((await executar("configurar_bom_dia", { ligado: false })).erro).toContain("Só o dono");
    expect(inseridas).toEqual([]);
    expect(ajustes.size).toBe(0);
  });

  it("listar mostra o bom dia e as rotinas com horário; desligar acha pelo nome sem acento", async () => {
    regras = [{ id: "a", name: "Trânsito para a Adalink", enabled: true, trigger: { kind: "cron", expr: "0 5 * * 2,3" } }, { id: "b", name: "Ao chegar", enabled: true, trigger: { kind: "event", type: "x" } }];
    const l = await executar("listar_rotinas");
    expect((l.bom_dia as { horario: string }).horario).toBe("07:00");
    expect(l.rotinas_com_horario).toEqual([{ nome: "Trânsito para a Adalink", ligada: true, quando: "às 05:00, ter e qua" }]);
    const d = await executar("desligar_rotina", { nome: "transito para a adalink" });
    expect(d.mensagem).toBe('Rotina "Trânsito para a Adalink" desligada.');
    expect(atualizacoes[0]).toMatchObject({ enabled: false });
  });
});
