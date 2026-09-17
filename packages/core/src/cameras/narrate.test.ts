import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regra 2 de privacidade da Fase 2 (PRD §4.2, decisão 9.6 de 17/09): câmera com
 * identificação ligada narra SÓ com modelo local, mesmo havendo chave de nuvem.
 */

const visionCalls: unknown[] = [];
vi.mock("@orbita/llm", () => ({
  resolveVisionModel: (opts?: unknown) => {
    visionCalls.push(opts);
    return { modelId: "fake" };
  },
}));
vi.mock("ai", () => ({ generateText: async () => ({ text: "uma pessoa na cozinha" }) }));

let linha: Record<string, unknown> | undefined;
const atualizados: unknown[] = [];
vi.mock("@orbita/db", () => {
  const cadeia = () => {
    const p: Record<string, unknown> = {};
    for (const k of ["select", "from", "innerJoin", "where", "limit", "update", "set"]) {
      p[k] = (...args: unknown[]) => {
        if (k === "set") atualizados.push(args[0]);
        return p;
      };
    }
    (p as { then: unknown }).then = (ok: (v: unknown) => void) => ok(linha ? [linha] : []);
    return p;
  };
  return { db: cadeia() };
});

import { narrateCameraEvent } from "./narrate";

beforeEach(() => {
  visionCalls.length = 0;
  atualizados.length = 0;
});

describe("narração de evento de câmera", () => {
  it("câmera que identifica pessoas: só modelo local", async () => {
    linha = { id: "e1", snapshot: "data:image/jpeg;base64,AAA", narration: null, identifica: true };
    await narrateCameraEvent("e1");
    expect(visionCalls[0]).toEqual({ localOnly: true });
  });

  it("câmera sem identificação: segue a configuração de visão de sempre", async () => {
    linha = { id: "e2", snapshot: "data:image/jpeg;base64,AAA", narration: null, identifica: false };
    await narrateCameraEvent("e2");
    expect(visionCalls[0]).toEqual({ localOnly: false });
  });

  it("narração já feita não chama modelo de novo", async () => {
    linha = { id: "e3", snapshot: "data:image/jpeg;base64,AAA", narration: "já narrado", identifica: true };
    expect(await narrateCameraEvent("e3")).toBe("já narrado");
    expect(visionCalls).toEqual([]);
  });

  it("evento sem imagem não narra", async () => {
    linha = { id: "e4", snapshot: null, narration: null, identifica: true };
    await expect(narrateCameraEvent("e4")).rejects.toThrow(/sem imagem/);
  });

  it("evento inexistente", async () => {
    linha = undefined;
    await expect(narrateCameraEvent("nao-existe")).rejects.toThrow(/não encontrado/);
  });
});
