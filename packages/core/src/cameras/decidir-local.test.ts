import { describe, expect, it } from "vitest";
import { decidirSoLocal } from "./narrate";

/**
 * Quem narra a cena de uma câmera que identifica pessoas.
 *
 * A decisão 9.6 mandava usar só modelo local, sem exceção. O dono a reviu em
 * 27/09/2026 com dois fatos:
 *
 *   1. MEDIDO nesta máquina: o `moondream` levou 43 s numa imagem real da
 *      webcam e devolveu "!!!". A regra não protegia nada; só inutilizava a
 *      câmera.
 *   2. Na nuvem (Render) NÃO existe modelo local. "Só local" ali significa
 *      "sem visão nenhuma" nessa câmera.
 *
 * O que continua intocado, e é outra regra: vetor de rosto e de voz só vão ao
 * `apps/perception`, com o guard de saída barrando destino não local (§5.4.1).
 * Identificar QUEM é segue em casa; o que passou a poder ir para a nuvem é a
 * descrição da cena.
 */
describe("a imagem desta câmera pode ir para a nuvem?", () => {
  it("câmera comum nunca é forçada ao local", () => {
    expect(decidirSoLocal(false, false)).toBe(false);
    // nem quando a config exige local: ela só fala de câmera que identifica
    expect(decidirSoLocal(false, true)).toBe(false);
  });

  it("câmera que identifica, com a config DESLIGADA, vai para a nuvem", () => {
    // é a decisão do dono e o padrão novo
    expect(decidirSoLocal(true, false)).toBe(false);
  });

  it("câmera que identifica, com a config LIGADA, fica em casa", () => {
    // o comportamento antigo continua disponível para quem o quiser
    expect(decidirSoLocal(true, true)).toBe(true);
  });
});
