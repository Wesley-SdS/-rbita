import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("./face", () => ({ identifyCameraEvent: vi.fn() }));
vi.mock("./gesture", () => ({ detectGestureForEvent: vi.fn() }));

import { shouldIdentify } from "./camera-listener";

/**
 * Freio da rajada: o Frigate manda vários eventos por segundo quando alguém
 * atravessa o campo de visão, e nesta máquina o reconhecimento é CPU.
 */
describe("quando vale identificar num evento de câmera", () => {
  const agora = 1_000_000;
  const labels = ["person", "pessoa"];

  it("rótulo com gente e sem evento recente: identifica", () => {
    expect(shouldIdentify("person", "cam1", agora, undefined, 5, labels)).toBe(true);
    expect(shouldIdentify("Pessoa", "cam1", agora, undefined, 5, labels)).toBe(true);
  });

  it("carro e movimento não acionam visão à toa", () => {
    expect(shouldIdentify("car", "cam1", agora, undefined, 5, labels)).toBe(false);
    expect(shouldIdentify("motion", "cam1", agora, undefined, 5, labels)).toBe(false);
  });

  it("respeita o intervalo mínimo por câmera", () => {
    expect(shouldIdentify("person", "cam1", agora, agora - 2000, 5, labels)).toBe(false);
    expect(shouldIdentify("person", "cam1", agora, agora - 6000, 5, labels)).toBe(true);
  });

  it("lista de rótulos vazia aceita qualquer coisa (o dono decide)", () => {
    expect(shouldIdentify("car", "cam1", agora, undefined, 5, [])).toBe(true);
  });
});
