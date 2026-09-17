import { describe, expect, it } from "vitest";
import { refreshDue } from "./refresh";

const base = 10 * 60_000; // intervalo do laço
const teto = 24 * 3_600_000;
const t0 = new Date("2026-09-17T10:00:00Z");
const depois = (ms: number) => new Date(t0.getTime() + ms);

describe("espera após falha de renovação (RV.4)", () => {
  it("sem falha: tenta sempre", () => {
    expect(refreshDue(0, null, t0, base, teto)).toBe(true);
  });

  it("primeira falha espera um intervalo", () => {
    expect(refreshDue(1, t0, depois(base - 1), base, teto)).toBe(false);
    expect(refreshDue(1, t0, depois(base), base, teto)).toBe(true);
  });

  it("dobra a cada falha seguida", () => {
    expect(refreshDue(3, t0, depois(base * 4 - 1), base, teto)).toBe(false);
    expect(refreshDue(3, t0, depois(base * 4), base, teto)).toBe(true);
  });

  it("nunca espera mais que o teto", () => {
    expect(refreshDue(30, t0, depois(teto), base, teto)).toBe(true);
  });

  it("contador sem data (dado inconsistente) não trava a renovação", () => {
    expect(refreshDue(2, null, t0, base, teto)).toBe(true);
  });
});
