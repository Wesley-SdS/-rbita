import { describe, it, expect } from "vitest";
import { decideOwner } from "./owner";

describe("posse da instância (RV.1)", () => {
  it("instância nova: o primeiro usuário reivindica", () => {
    expect(decideOwner(null, "u1", null)).toEqual({ ownerId: "u1", claim: "u1" });
  });

  it("dono vivo continua dono, sem regravar", () => {
    expect(decideOwner({ userId: "u1" }, "u0", null)).toEqual({ ownerId: "u1", claim: null });
  });

  it("o ambiente não toma a posse de um dono vivo", () => {
    expect(decideOwner({ userId: "u1" }, "u0", "u2")).toEqual({ ownerId: "u1", claim: null });
  });

  it("conta do dono apagada: ninguém é promovido sozinho", () => {
    // o usuário mais antigo restante NÃO vira dono (era o risco do dono deduzido)
    expect(decideOwner({ userId: null }, "u2", null)).toEqual({ ownerId: null, claim: null });
  });

  it("instância órfã se recupera só pelo ORBITA_OWNER_EMAIL", () => {
    expect(decideOwner({ userId: null }, "u2", "u3")).toEqual({ ownerId: "u3", claim: "u3" });
  });

  it("sem usuários nem ambiente: sem dono", () => {
    expect(decideOwner(null, null, null)).toEqual({ ownerId: null, claim: null });
  });
});
