import { describe, it, expect } from "vitest";
import { canAccessRoom } from "./permission";

describe("canAccessRoom", () => {
  it("dono sempre pode, mesmo sem nenhum acesso explícito e mesmo com negação explícita", () => {
    expect(canAccessRoom("dono", "quarto-1", [])).toBe(true);
    expect(canAccessRoom("dono", "quarto-1", [{ roomId: "quarto-1", allowed: false }])).toBe(true);
  });

  it("morador pode por padrão, sem precisar de acesso explícito", () => {
    expect(canAccessRoom("morador", "sala", [])).toBe(true);
  });
  it("morador respeita negação explícita", () => {
    expect(canAccessRoom("morador", "escritorio", [{ roomId: "escritorio", allowed: false }])).toBe(false);
  });

  it("visitante é negado por padrão, sem acesso explícito", () => {
    expect(canAccessRoom("visitante", "quarto-1", [])).toBe(false);
  });
  it("visitante pode onde foi explicitamente liberado", () => {
    expect(canAccessRoom("visitante", "sala", [{ roomId: "sala", allowed: true }])).toBe(true);
  });
  it("acesso explícito de outro cômodo não vaza para este", () => {
    expect(canAccessRoom("visitante", "quarto-1", [{ roomId: "sala", allowed: true }])).toBe(false);
  });

  it("entidade sem cômodo associado (roomId nulo): trata como sem regra explícita", () => {
    expect(canAccessRoom("morador", null, [])).toBe(true);
    expect(canAccessRoom("visitante", null, [])).toBe(false);
  });
});
