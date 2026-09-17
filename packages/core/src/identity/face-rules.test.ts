import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("../perception/client", () => ({}));
vi.mock("./presence", () => ({ updatePresence: vi.fn() }));

import { mainFace } from "./face";
import type { FaceResult } from "../perception/client";

const rosto = (size: number, score = 0.99): FaceResult => ({ bbox: [0, 0, size, size], score, size, embedding: [1, 0] });

/**
 * Rosto pequeno identifica mal (PRD §7): abaixo do mínimo configurado, a
 * Órbita prefere não ter rosto a ter um palpite ruim.
 */
describe("rosto principal da imagem", () => {
  it("pega o maior acima do mínimo", () => {
    expect(mainFace([rosto(70), rosto(120), rosto(40)], 60)?.size).toBe(120);
  });

  it("todos pequenos: nenhum", () => {
    expect(mainFace([rosto(30), rosto(59)], 60)).toBeNull();
  });

  it("imagem sem rosto", () => {
    expect(mainFace([], 60)).toBeNull();
  });

  it("no limite conta", () => {
    expect(mainFace([rosto(60)], 60)?.size).toBe(60);
  });
});
