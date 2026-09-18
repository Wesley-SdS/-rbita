import { describe, expect, it } from "vitest";
import { conexaoOciosa, impressaoDoServidor, podeRepetirChamada, precisaBuscarCatalogo } from "./pool-rules";

describe("quando buscar o catálogo de tools", () => {
  const agora = Date.parse("2026-09-18T12:00:00Z");
  const dia = 86_400_000;
  it("sem catálogo, busca", () => {
    expect(precisaBuscarCatalogo({ temCatalogo: false, catalogoEm: null }, agora, dia, undefined)).toBe(true);
  });
  it("catálogo fresco, não busca (é o caso de toda mensagem)", () => {
    expect(precisaBuscarCatalogo({ temCatalogo: true, catalogoEm: new Date(agora - 1000) }, agora, dia, undefined)).toBe(false);
  });
  it("catálogo vencido, busca", () => {
    expect(precisaBuscarCatalogo({ temCatalogo: true, catalogoEm: new Date(agora - 2 * dia) }, agora, dia, undefined)).toBe(true);
  });
  it("falhou há pouco: espera antes de tentar de novo, mesmo sem catálogo", () => {
    expect(precisaBuscarCatalogo({ temCatalogo: false, catalogoEm: null }, agora, dia, agora + 30_000)).toBe(false);
  });
});

describe("conexão e repetição", () => {
  it("fecha conexão parada além do limite", () => {
    expect(conexaoOciosa(0, 16 * 60_000, 15 * 60_000)).toBe(true);
    expect(conexaoOciosa(0, 60_000, 15 * 60_000)).toBe(false);
  });
  it("só leitura pode ser repetida depois de reconectar", () => {
    expect(podeRepetirChamada(true)).toBe(true);
    expect(podeRepetirChamada(false)).toBe(false);
  });
  it("mudar URL ou cabeçalho é outra conexão", () => {
    expect(impressaoDoServidor("https://a", { x: 1 })).not.toBe(impressaoDoServidor("https://a", { x: 2 }));
    expect(impressaoDoServidor("https://a", null)).toBe(impressaoDoServidor("https://a", undefined));
  });
});
