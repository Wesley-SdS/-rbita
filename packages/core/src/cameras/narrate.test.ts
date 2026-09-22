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
  // a narração passou a ter FILA de provedores. Com uma nuvem na fila, estes
  // testes provam o que importa: câmera que identifica NUNCA chega nela, e
  // câmera comum tenta a nuvem primeiro.
  provedoresDeVisaoEmOrdem: () => ["gemini"],
}));
// o registro de consumo é best-effort e não deve exigir banco aqui
vi.mock("../usage/registrar", () => ({ registrarUso: () => {}, FLUXO: { visao: "visao" } }));
vi.mock("ai", () => ({ generateText: async () => ({ text: "uma pessoa na cozinha" }) }));
// o modelo de visão virou config (§5.6): o nome sai daqui, não de constante
vi.mock("../settings", () => ({
  settings: {
    getMany: async () => ({ "vision.localModel": "moondream", "vision.cloudModel": "gpt-4o" }),
    get: async (k: string) => (k === "vision.localModel" ? "moondream" : "gpt-4o"),
  },
}));

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
    // o nome do modelo local vem da config, junto com a trava de privacidade
    // a regra guardada aqui é "câmera que identifica não vai para a nuvem".
    // As demais opções (provedor tentado, dono da conta) podem crescer.
    expect(visionCalls[0]).toMatchObject({ localOnly: true, local: "moondream", cloud: "gpt-4o" });
    // e a nuvem não é tentada em NENHUMA posição da fila (decisão 9.6)
    expect(visionCalls.every((c) => (c as { localOnly?: boolean }).localOnly)).toBe(true);
  });

  it("câmera sem identificação: segue a configuração de visão de sempre", async () => {
    linha = { id: "e2", snapshot: "data:image/jpeg;base64,AAA", narration: null, identifica: false };
    await narrateCameraEvent("e2");
    // a primeira tentativa é a NUVEM: é isso que "não está barrada" significa
    expect(visionCalls[0]).toMatchObject({ localOnly: false, cloudProvider: "gemini", local: "moondream", cloud: "gpt-4o" });
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
