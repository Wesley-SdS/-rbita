import { describe, expect, it } from "vitest";
import { APELIDO_MAX, gravarApelido, lerApelidos } from "./apelidos";

describe("apelidos dos Jiras", () => {
  it("lê uma linha por site e ignora linha torta", () => {
    expect(lerApelidos("chatguru=CG\nlixo sem igual\n=sem site\nadalink=")).toEqual({ chatguru: "CG" });
  });

  it("grava, troca e remove sem mexer nos outros sites", () => {
    let t = gravarApelido("", "chatguru", "CG");
    t = gravarApelido(t, "cia", "CIA");
    expect(lerApelidos(t)).toEqual({ chatguru: "CG", cia: "CIA" });
    t = gravarApelido(t, "chatguru", "ChatGuru");
    expect(lerApelidos(t)).toEqual({ chatguru: "ChatGuru", cia: "CIA" });
    t = gravarApelido(t, "cia", "  ");
    expect(lerApelidos(t)).toEqual({ chatguru: "ChatGuru" });
  });

  it("quebra de linha e igual no apelido não forjam outra entrada", () => {
    const t = gravarApelido("", "chatguru", "CG\nadmin=ROOT");
    expect(Object.keys(lerApelidos(t))).toEqual(["chatguru"]);
  });

  it("respeita o tamanho máximo", () => {
    const t = gravarApelido("", "x", "a".repeat(APELIDO_MAX + 30));
    expect(lerApelidos(t).x).toHaveLength(APELIDO_MAX);
  });
});
