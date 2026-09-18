import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O executor, com a fila simulada. O que está sendo provado: o resultado do
 * handler vira "feito", o erro vira retentativa ou falha na classe certa, o
 * pedido de parar é respeitado nos dois momentos (antes de começar e no meio),
 * e o trabalho em execução fica protegido da recuperação de zumbis.
 */

type J = { id: string; kind: string; userId: string; payload: Record<string, unknown>; input: string | null; progressDone: number; attempts: number; cancelRequested: boolean };

let proximo: J | null = null;
let cancelarNoProgresso = false;
const chamadas: { fn: string; args: unknown[] }[] = [];
let decisaoDeFalha: "retentar" | "desistir" = "retentar";

vi.mock("../settings", () => ({ settings: { get: async () => 5 } }));
vi.mock("./queue", () => {
  class JobPermanentError extends Error {}
  return {
    JobPermanentError,
    claimJob: async () => {
      const j = proximo;
      proximo = null;
      return j;
    },
    finishJob: async (...args: unknown[]) => void chamadas.push({ fn: "finish", args }),
    markCancelled: async (...args: unknown[]) => void chamadas.push({ fn: "cancelled", args }),
    failJob: async (...args: unknown[]) => {
      chamadas.push({ fn: "fail", args });
      return decisaoDeFalha;
    },
    reportProgress: async (...args: unknown[]) => {
      chamadas.push({ fn: "progress", args });
      return { cancelado: cancelarNoProgresso };
    },
    touchHeartbeat: async () => undefined,
  };
});

import { registerJobs, _resetJobRegistry } from "./registry";
import { jobsEmExecucao, runNextJob, drainJobs } from "./runner";
import { JobPermanentError } from "./queue";

const job = (over: Partial<J> = {}): J => ({ id: "j1", kind: "teste.ok", userId: "dono", payload: {}, input: null, progressDone: 0, attempts: 1, cancelRequested: false, ...over });

let vistoDuranteExecucao: boolean | null = null;

beforeEach(() => {
  _resetJobRegistry();
  proximo = null;
  cancelarNoProgresso = false;
  chamadas.length = 0;
  decisaoDeFalha = "retentar";
  vistoDuranteExecucao = null;
  registerJobs([
    {
      kind: "teste.ok",
      title: () => "ok",
      run: async (ctx) => {
        vistoDuranteExecucao = jobsEmExecucao().has(ctx.jobId);
        await ctx.progresso(1, 2, "meio");
        return { pronto: true };
      },
    },
    { kind: "teste.passageiro", title: () => "x", run: async () => { throw new Error("serviço fora do ar"); } },
    { kind: "teste.permanente", title: () => "x", run: async () => { throw new JobPermanentError("arquivo ilegível"); } },
  ]);
});

describe("uma volta do executor", () => {
  it("fila vazia não faz nada", async () => {
    expect(await runNextJob("inst")).toBe("vazio");
    expect(chamadas).toEqual([]);
  });

  it("deu certo: grava o resultado", async () => {
    proximo = job();
    expect(await runNextJob("inst")).toBe("feito");
    expect(chamadas.find((c) => c.fn === "finish")?.args).toEqual(["j1", { pronto: true }]);
  });

  it("enquanto roda, o trabalho está protegido da recuperação de zumbis; depois, não", async () => {
    proximo = job();
    await runNextJob("inst");
    expect(vistoDuranteExecucao).toBe(true);
    expect(jobsEmExecucao().has("j1")).toBe(false);
  });

  it("erro passageiro vai para a política de falha, que decide retentar", async () => {
    proximo = job({ kind: "teste.passageiro" });
    expect(await runNextJob("inst")).toBe("retentar");
    expect(chamadas.some((c) => c.fn === "fail")).toBe(true);
  });

  it("erro passageiro na última tentativa vira falha", async () => {
    decisaoDeFalha = "desistir";
    proximo = job({ kind: "teste.passageiro" });
    expect(await runNextJob("inst")).toBe("falhou");
  });

  it("erro permanente chega marcado como permanente", async () => {
    proximo = job({ kind: "teste.permanente" });
    await runNextJob("inst");
    const falha = chamadas.find((c) => c.fn === "fail")!;
    expect(falha.args[1]).toBeInstanceOf(JobPermanentError);
  });

  it("pedido de parar antes de começar: nem roda o handler", async () => {
    proximo = job({ cancelRequested: true });
    expect(await runNextJob("inst")).toBe("cancelado");
    expect(vistoDuranteExecucao).toBeNull();
    expect(chamadas.map((c) => c.fn)).toEqual(["cancelled"]);
  });

  it("pedido de parar no meio: para no próximo progresso, sem virar falha", async () => {
    cancelarNoProgresso = true;
    proximo = job();
    expect(await runNextJob("inst")).toBe("cancelado");
    expect(chamadas.some((c) => c.fn === "finish" || c.fn === "fail")).toBe(false);
  });

  it("handler que sumiu falha como permanente, sem retentar", async () => {
    proximo = job({ kind: "nao.existe" });
    expect(await runNextJob("inst")).toBe("sem_handler");
    const falha = chamadas.find((c) => c.fn === "fail")!;
    expect(falha.args[2]).toBe(true);
  });
});

describe("esvaziar a fila", () => {
  it("para quando a fila acaba", async () => {
    proximo = job();
    expect(await drainJobs("inst")).toBe(1);
  });
});
