import { describe, it, expect } from "vitest";
import { dataUrlSizeKB } from "./ingest";

describe("cameras: tamanho do snapshot", () => {
  it("calcula o tamanho em KB a partir do base64 da data URL", () => {
    // 4 caracteres base64 = 3 bytes; 4096 caracteres ≈ 3072 bytes = 3 KB
    const b64 = "A".repeat(4096);
    expect(dataUrlSizeKB(`data:image/jpeg;base64,${b64}`)).toBe(3);
  });

  it("string vazia depois da vírgula dá 0 KB, sem lançar", () => {
    expect(dataUrlSizeKB("data:image/jpeg;base64,")).toBe(0);
  });

  it("sem vírgula (entrada malformada) não lança, trata tudo como conteúdo", () => {
    expect(dataUrlSizeKB("nao-e-data-url")).toBeGreaterThanOrEqual(0);
  });
});
