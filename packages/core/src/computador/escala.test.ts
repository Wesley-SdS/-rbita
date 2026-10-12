import { describe, expect, it } from "vitest";
import { fatorParaCaber, imagemCabe, lerPonto, pontoNaCaptura, regiaoDoZoom, type CapturaVista } from "./escala";

const CAP: CapturaVista = { id: "c1", largura: 1280, altura: 720 };

/**
 * O motor não faz aritmética de DPI (as mãos guardam a escala de cada captura),
 * mas decide o que ENTRA nelas: só ponto dentro da imagem que o Claude viu, da
 * captura certa. A conversão de 100%, 125% e 150% e dos três monitores é testada
 * onde ela mora, em apps/maos (test_captura.py).
 */
describe("pontoNaCaptura", () => {
  it("devolve o alvo na captura do último screenshot, com o ponto arredondado", () => {
    expect(pontoNaCaptura([640.4, 360.6], CAP)).toEqual({ captura: "c1", x: 640, y: 361 });
    expect(pontoNaCaptura({ x: 10, y: 20 }, CAP)).toEqual({ captura: "c1", x: 10, y: 20 });
  });

  it("recusa ponto fora da imagem, inclusive na borda de fora", () => {
    expect(pontoNaCaptura([1280, 10], CAP)).toMatchObject({ erro: expect.stringMatching(/fora do screenshot/) });
    expect(pontoNaCaptura([10, 720], CAP)).toMatchObject({ erro: expect.stringMatching(/fora do screenshot/) });
    expect(pontoNaCaptura([-1, 5], CAP)).toMatchObject({ erro: expect.stringMatching(/fora do screenshot/) });
    expect(pontoNaCaptura([1279, 719], CAP)).toEqual({ captura: "c1", x: 1279, y: 719 });
  });

  it("sem screenshot ainda, ou com ponto torto, é erro (não clica às cegas)", () => {
    expect(pontoNaCaptura([1, 1], null)).toMatchObject({ erro: expect.stringMatching(/screenshot/) });
    expect(pontoNaCaptura("10,20", CAP)).toMatchObject({ erro: expect.stringMatching(/inválido/) });
    expect(pontoNaCaptura([Number.NaN, 1], CAP)).toMatchObject({ erro: expect.stringMatching(/inválido/) });
  });
});

describe("regiaoDoZoom", () => {
  it("ordena os cantos e recorta no tamanho da imagem", () => {
    expect(regiaoDoZoom([400, 300, 100, 50], CAP)).toEqual({ captura: "c1", x0: 100, y0: 50, x1: 400, y1: 300 });
    expect(regiaoDoZoom([-50, -50, 5000, 5000], CAP)).toEqual({ captura: "c1", x0: 0, y0: 0, x1: 1280, y1: 720 });
  });

  it("recusa região minúscula, torta ou sem captura", () => {
    expect(regiaoDoZoom([10, 10, 14, 200], CAP)).toMatchObject({ erro: expect.stringMatching(/pequena demais/) });
    expect(regiaoDoZoom([1, 2, 3], CAP)).toMatchObject({ erro: expect.stringMatching(/inválida/) });
    expect(regiaoDoZoom([0, 0, 100, 100], null)).toMatchObject({ erro: expect.stringMatching(/captura/) });
  });
});

describe("limite de imagem da API", () => {
  it("1280x720 e 1920x1080 cabem; 4K não", () => {
    expect(imagemCabe(1280, 720)).toBe(true);
    expect(imagemCabe(1920, 1080)).toBe(true);
    expect(imagemCabe(3840, 2160)).toBe(false);
    expect(fatorParaCaber(1280, 720)).toBe(1);
  });

  it("o fator de redução leva a imagem de volta para dentro do limite", () => {
    const f = fatorParaCaber(3840, 2160);
    expect(f).toBeLessThan(1);
    expect(imagemCabe(Math.floor(3840 * f), Math.floor(2160 * f))).toBe(true);
    const g = fatorParaCaber(5000, 1000);
    expect(imagemCabe(Math.floor(5000 * g), Math.floor(1000 * g))).toBe(true);
  });

  it("lerPonto aceita só par numérico ou {x, y}", () => {
    expect(lerPonto([1, 2])).toEqual([1, 2]);
    expect(lerPonto([1, "2"])).toBeNull();
    expect(lerPonto(null)).toBeNull();
  });
});
