import { describe, it, expect } from "vitest";
import { dimensoesDoQuadro, tamanhoDaDataUrlKB } from "./aparelho";

describe("redução do quadro antes de subir", () => {
  it("reduz mantendo a proporção", () => {
    expect(dimensoesDoQuadro(1280, 720, 640)).toEqual({ largura: 640, altura: 360 });
    expect(dimensoesDoQuadro(1920, 1080, 800)).toEqual({ largura: 800, altura: 450 });
  });

  it("NÃO aumenta uma câmera pequena", () => {
    // esticar 320 para 640 inventaria pixels e pesaria o dobro pelo mesmo detalhe
    expect(dimensoesDoQuadro(320, 240, 640)).toEqual({ largura: 320, altura: 240 });
  });

  it("na largura exata não mexe", () => {
    expect(dimensoesDoQuadro(640, 480, 640)).toEqual({ largura: 640, altura: 480 });
  });

  it("câmera que ainda não entregou quadro não vira divisão por zero", () => {
    expect(dimensoesDoQuadro(0, 0, 640)).toEqual({ largura: 0, altura: 0 });
  });

  it("proporção extrema não vira altura zero", () => {
    expect(dimensoesDoQuadro(4000, 10, 640).altura).toBeGreaterThanOrEqual(1);
  });
});

describe("tamanho da data URL", () => {
  it("conta só o conteúdo, não o cabeçalho", () => {
    // 4 caracteres de base64 = 3 bytes; o "data:image/jpeg;base64," não conta
    const quatroMil = "A".repeat(4096);
    expect(tamanhoDaDataUrlKB("data:image/jpeg;base64," + quatroMil)).toBe(3);
  });

  it("string sem vírgula não quebra", () => {
    expect(tamanhoDaDataUrlKB("nao-e-data-url")).toBe(0);
  });
});
