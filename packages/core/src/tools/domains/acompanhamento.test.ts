import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools de acompanhar tarefa (CLAUDE.md §5.7: sem teste de execute não está
 * pronta). O que importa: acompanhar é olhar a câmera, então pede a mesma
 * permissão de cômodo que ver a câmera; quem faz a tarefa é quem pediu (é por
 * onde a Órbita avisa); e erro de domínio vira resposta, não exceção.
 */

let ativa: { id: string; title: string; steps: string[]; currentStep: number; status: string } | null = null;
let recusa: string | null = null;
const iniciadas: unknown[] = [];

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("../../cameras/query", () => ({
  findCamera: async (_u: string, q: string) => (q === "garagem" ? null : { id: "cam1", roomId: "cozinha", name: "Cozinha" }),
}));
vi.mock("../../home/room-permission", () => ({ authorizeRoomForRequester: async () => recusa }));
vi.mock("../../guided/task", async () => {
  const { IdentityError } = await import("../../identity/errors");
  return {
    startGuidedTask: async (_u: string, input: { titulo: string; passos: string[]; comodo: string; personId: string | null }) => {
      if (ativa) throw new IdentityError(`Já estou acompanhando "${ativa.title}". Encerre antes de começar outra.`, 409);
      iniciadas.push(input);
      return { id: "t1", title: input.titulo, steps: input.passos, intervalSeconds: 45, expiresAt: new Date(Date.now() + 120 * 60_000) };
    },
    currentGuidedTask: async () => ativa,
    stopGuidedTask: async () => (ativa ? { ...ativa, status: "cancelada" } : null),
    setGuidedStep: async (_u: string, _id: string, passo: number) =>
      ativa && passo < ativa.steps.length ? { ...ativa, currentStep: passo, status: "ativa" } : { ...ativa!, status: "concluida" },
    listGuidedTasks: async () =>
      ativa ? [{ id: ativa.id, titulo: ativa.title, passos: ativa.steps, passoAtual: ativa.currentStep, status: ativa.status, comodo: "Cozinha", camera: "Cozinha", ultimaObservacao: "massa na tigela" }] : [],
  };
});

import { acompanhar_tarefa, parar_acompanhamento, proximo_passo_da_tarefa, status_da_tarefa } from "./acompanhamento";
import { needsApproval } from "../registry";

const ctxDe = (personId: string | null = "p-anna") => ({ userId: "dono", requester: async () => ({ personId, name: "Anna", role: "morador" as const, via: "voz" as const }) });

beforeEach(() => {
  ativa = null;
  recusa = null;
  iniciadas.length = 0;
});

describe("acompanhar tarefa", () => {
  it("começa com os passos e guarda quem está fazendo (é por onde a Órbita avisa)", async () => {
    const r = (await acompanhar_tarefa.run({ titulo: "bolo", passos: ["bater", "assar"], comodo: "cozinha" }, ctxDe())) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, tarefa: "bolo", passos: 2, primeiroPasso: "bater" });
    expect(iniciadas[0]).toMatchObject({ personId: "p-anna" });
    expect(String(r.aviso)).toMatch(/encerra sozinho/);
  });

  it("pede a mesma permissão de cômodo que ver a câmera", async () => {
    recusa = "Quem pediu não tem permissão para acompanhar uma tarefa pela câmera neste cômodo.";
    expect(await acompanhar_tarefa.authorize!({ titulo: "x", passos: ["a"], comodo: "quarto" }, ctxDe())).toBe(recusa);
  });

  it("câmera inexistente não bloqueia na permissão: a tool explica", async () => {
    expect(await acompanhar_tarefa.authorize!({ titulo: "x", passos: ["a"], comodo: "garagem" }, ctxDe())).toBeNull();
  });

  it("já havendo uma tarefa, responde o motivo em vez de estourar", async () => {
    ativa = { id: "t0", title: "pão", steps: ["a"], currentStep: 0, status: "ativa" };
    expect(await acompanhar_tarefa.run({ titulo: "bolo", passos: ["a"], comodo: "cozinha" }, ctxDe())).toMatchObject({ erro: expect.stringContaining("pão") });
  });

  it("é escrita, não perigosa: roda sem fila de aprovação", () => {
    expect(needsApproval(acompanhar_tarefa.risk)).toBe(false);
  });
});

describe("durante a tarefa", () => {
  beforeEach(() => {
    ativa = { id: "t1", title: "bolo", steps: ["bater", "untar", "assar"], currentStep: 0, status: "ativa" };
  });

  it("próximo passo à mão diz qual é", async () => {
    expect(await proximo_passo_da_tarefa.run({}, ctxDe())).toMatchObject({ passo: 2, de: 3, texto: "untar" });
  });

  it("no último passo, conclui", async () => {
    ativa!.currentStep = 2;
    expect(await proximo_passo_da_tarefa.run({}, ctxDe())).toMatchObject({ concluiu: true });
  });

  it("status mostra o passo, o que falta e o que a câmera achou", async () => {
    const r = (await status_da_tarefa.run({}, ctxDe())) as Record<string, unknown>;
    expect(r).toMatchObject({ tarefa: "bolo", passo: 1, de: 3, faltam: ["untar", "assar"], ultimaObservacao: "massa na tigela" });
  });

  it("parar encerra", async () => {
    expect(await parar_acompanhamento.run({}, ctxDe())).toMatchObject({ ok: true, tarefa: "bolo" });
  });
});

describe("sem tarefa ativa", () => {
  it("todas respondem sem erro", async () => {
    expect(await status_da_tarefa.run({}, ctxDe())).toMatchObject({ resposta: expect.stringContaining("Não há") });
    expect(await proximo_passo_da_tarefa.run({}, ctxDe())).toMatchObject({ aviso: expect.stringContaining("Não há") });
    expect(await parar_acompanhamento.run({}, ctxDe())).toMatchObject({ aviso: expect.stringContaining("Não havia") });
  });
});
