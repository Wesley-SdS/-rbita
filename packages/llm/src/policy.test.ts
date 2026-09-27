import { describe, expect, it } from "vitest";
import { deveDescobrirLocal, ollamaAlcancavel, type ModelPolicy } from "./policy";

type P = Pick<ModelPolicy, "descobrirLocal" | "failoverOrder" | "defaultPreference" | "localDisponivel">;
const assinatura: P = { descobrirLocal: "auto", failoverOrder: "assinatura_paga_local", defaultPreference: "nuvem", localDisponivel: "auto" };

describe("ollamaAlcancavel (E4)", () => {
  it("na Render, localhost é o próprio contêiner: sem Ollama", () => {
    expect(ollamaAlcancavel("auto", { RENDER: "true", OLLAMA_BASE_URL: "http://localhost:11434/v1" })).toBe(false);
    expect(ollamaAlcancavel("auto", { RENDER: "true" })).toBe(false);
  });

  it("vale para qualquer ambiente gerenciado, não só a Vercel", () => {
    for (const k of ["VERCEL", "FLY_APP_NAME", "K_SERVICE"]) expect(ollamaAlcancavel("auto", { [k]: "1" })).toBe(false);
  });

  it("Ollama remoto continua valendo na nuvem", () => {
    expect(ollamaAlcancavel("auto", { RENDER: "true", OLLAMA_BASE_URL: "http://gpu.casa.lan:11434/v1" })).toBe(true);
  });

  it("em casa, com localhost, é alcançável", () => {
    expect(ollamaAlcancavel("auto", {})).toBe(true);
  });

  it("a escolha do dono vence a dedução", () => {
    expect(ollamaAlcancavel("nao", {})).toBe(false);
    expect(ollamaAlcancavel("sim", { RENDER: "true" })).toBe(true);
  });
});

describe("deveDescobrirLocal (E3)", () => {
  it("dono em assinatura com o local no fim: não pergunta ao Ollama", () => {
    expect(deveDescobrirLocal(assinatura, {})).toBe(false);
    expect(deveDescobrirLocal({ ...assinatura, failoverOrder: "paga_primeiro" }, {})).toBe(false);
  });

  it("local preferido ou antes de alguma nuvem: pergunta", () => {
    expect(deveDescobrirLocal({ ...assinatura, defaultPreference: "local" }, {})).toBe(true);
    expect(deveDescobrirLocal({ ...assinatura, failoverOrder: "local_primeiro" }, {})).toBe(true);
    expect(deveDescobrirLocal({ ...assinatura, failoverOrder: "assinatura_local_paga" }, {})).toBe(true);
  });

  it("sempre e nunca mandam", () => {
    expect(deveDescobrirLocal({ ...assinatura, descobrirLocal: "sempre" }, {})).toBe(true);
    expect(deveDescobrirLocal({ ...assinatura, descobrirLocal: "nunca", defaultPreference: "local" }, {})).toBe(false);
  });

  it("sem Ollama alcançável, nem o sempre pergunta", () => {
    expect(deveDescobrirLocal({ ...assinatura, descobrirLocal: "sempre" }, { RENDER: "1" })).toBe(false);
  });
});
