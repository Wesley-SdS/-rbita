import { describe, it, expect } from "vitest";
import { avaliarGravacao, BYTES_MINIMOS } from "./gravacao";

/**
 * O caso que originou a guarda está medido: 315 bytes de WebM subiram, viraram
 * um trabalho de fila, gastaram uma transcrição paga e voltaram vazios.
 */
describe("gravação vale uma transcrição?", () => {
  it("fala de verdade passa", () => {
    expect(avaliarGravacao(240_000, 80)).toEqual({ vale: true });
  });

  it("o caso real: cabeçalho de 315 bytes não sobe", () => {
    const r = avaliarGravacao(315, 12);
    expect(r.vale).toBe(false);
    if (!r.vale) expect(r.recado).toMatch(/muda/i);
  });

  it("arquivo vazio não sobe", () => {
    const r = avaliarGravacao(0, 30);
    expect(r.vale).toBe(false);
    if (!r.vale) expect(r.recado).toMatch(/som nenhum/i);
  });

  it("clique sem querer não sobe, mesmo com bytes", () => {
    const r = avaliarGravacao(50_000, 0);
    expect(r.vale).toBe(false);
    if (!r.vale) expect(r.recado).toMatch(/menos de um segundo/i);
  });

  it("nenhum recado acusa a pessoa nem fala em erro", () => {
    for (const caso of [avaliarGravacao(0, 5), avaliarGravacao(315, 12), avaliarGravacao(9_000, 0)]) {
      if (!caso.vale) {
        expect(caso.recado).not.toMatch(/erro|falha|inválid/i);
        expect(caso.recado.length).toBeGreaterThan(20); // diz o que fazer, não só o que houve
      }
    }
  });

  it("o piso é de tamanho, e o limite exato passa", () => {
    expect(avaliarGravacao(BYTES_MINIMOS, 5)).toEqual({ vale: true });
    expect(avaliarGravacao(BYTES_MINIMOS - 1, 5).vale).toBe(false);
  });
});
