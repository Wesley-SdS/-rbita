import { describe, expect, it } from "vitest";
import { centroid, cosineSim, matchSignature, type MatchConfig } from "./match";

const cfg: MatchConfig = { threshold: 0.7, probableThreshold: 0.5, margin: 0.08, minSpeechSeconds: 2 };
const wesley = { personId: "w", vectors: [[1, 0, 0], [0.95, 0.1, 0]] };
const anna = { personId: "a", vectors: [[0, 1, 0], [0.1, 0.95, 0]] };

describe("cosseno e centroide", () => {
  it("cosseno ignora escala", () => {
    expect(cosineSim([2, 0], [5, 0])).toBeCloseTo(1);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("vetores de modelos diferentes não se comparam", () => {
    expect(() => cosineSim([1, 0], [1, 0, 0])).toThrow(/modelos distintos/);
  });

  it("centroide normalizado", () => {
    const c = centroid([[1, 0], [0, 1]]);
    expect(c[0]).toBeCloseTo(Math.SQRT1_2);
    expect(() => centroid([])).toThrow();
  });
});

describe("casamento de assinatura", () => {
  it("identifica com confiança quando acima do limiar e com folga", () => {
    const r = matchSignature([0.98, 0.05, 0], [wesley, anna], cfg, 4);
    expect(r).toMatchObject({ outcome: "identificado", personId: "w" });
    expect(r.runnerUp?.personId).toBe("a");
  });

  it("fala curta nunca vira afirmação: provável", () => {
    expect(matchSignature([0.98, 0.05, 0], [wesley, anna], cfg, 1.2)).toMatchObject({ outcome: "provavel", personId: "w", reason: "fala_curta" });
  });

  it("duas pessoas parecidas: sem folga vira provável", () => {
    const r = matchSignature([0.72, 0.69, 0], [wesley, anna], cfg, 5);
    expect(r.outcome).toBe("provavel");
    expect(r.reason).toBe("sem_folga");
  });

  it("entre o limiar de provável e o de identificação: provável", () => {
    expect(matchSignature([0.6, 0, 0.8], [wesley], cfg, 5)).toMatchObject({ outcome: "provavel", reason: "abaixo_do_limiar" });
  });

  it("abaixo de provável: desconhecido, sem nome", () => {
    expect(matchSignature([0, 0, 1], [wesley, anna], cfg, 5)).toMatchObject({ outcome: "desconhecido", personId: null });
  });

  it("sem ninguém cadastrado: desconhecido", () => {
    expect(matchSignature([1, 0, 0], [], cfg)).toMatchObject({ outcome: "desconhecido", reason: "sem_cadastro" });
    expect(matchSignature([1, 0, 0], [{ personId: "x", vectors: [] }], cfg).reason).toBe("sem_cadastro");
  });
});
