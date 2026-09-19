import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("@orbita/db/knowledge-schema", () => ({ chunk: {}, document: {}, memory: {} }));

import { fundirRRF } from "./retrieve";

/** Candidato mínimo para exercitar a fusão (o resto do objeto não importa aqui). */
const c = (id: string, via: "vetor" | "texto") => ({ chave: id, content: id, source: "doc", sim: 0, via });

describe("fusão por RRF", () => {
  it("quem aparece nas duas listas sobe acima de quem só aparece numa", () => {
    // "b" é segundo nos dois lados; "a" é primeiro só no vetor
    const vetor = [c("a", "vetor"), c("b", "vetor"), c("x", "vetor")];
    const texto = [c("y", "texto"), c("b", "texto"), c("z", "texto")];
    const r = fundirRRF([{ itens: vetor, peso: 1 }, { itens: texto, peso: 1 }], 60, 5);
    expect(r[0]!.chave).toBe("b");
    expect(r[0]!.via).toBe("ambos");
  });

  it("peso zero de um lado o remove da decisão", () => {
    const vetor = [c("a", "vetor")];
    const texto = [c("b", "texto"), c("c", "texto")];
    const r = fundirRRF([{ itens: vetor, peso: 1 }, { itens: texto, peso: 0 }], 60, 3);
    expect(r[0]!.chave).toBe("a");
  });

  it("k menor dá mais vantagem a quem ficou em primeiro", () => {
    const vetor = [c("a", "vetor"), c("b", "vetor")];
    const texto = [c("b", "texto"), c("a", "texto")];
    // empate por simetria: o que muda com k é a distância entre os scores
    const comKPequeno = fundirRRF([{ itens: vetor, peso: 1 }, { itens: [c("z", "texto")], peso: 1 }], 1, 5);
    const comKGrande = fundirRRF([{ itens: vetor, peso: 1 }, { itens: [c("z", "texto")], peso: 1 }], 500, 5);
    const distancia = (r: { sim: number }[]) => r[0]!.sim - r[r.length - 1]!.sim;
    expect(distancia(comKPequeno)).toBeGreaterThan(distancia(comKGrande));
    expect(texto.length).toBe(2); // o lado textual existe, só não foi usado neste caso
  });

  it("respeita o limite pedido", () => {
    const muitos = Array.from({ length: 50 }, (_, i) => c(`c${i}`, "vetor"));
    expect(fundirRRF([{ itens: muitos, peso: 1 }], 60, 4)).toHaveLength(4);
  });

  it("lista vazia de um lado não quebra a fusão", () => {
    const r = fundirRRF([{ itens: [], peso: 1 }, { itens: [c("a", "texto")], peso: 1 }], 60, 3);
    expect(r).toHaveLength(1);
    expect(r[0]!.via).toBe("texto");
  });
});
