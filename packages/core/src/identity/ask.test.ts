import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("../settings", () => ({ settings: { get: async () => "negado" } }));

import { findPersonByName } from "./ask";

type P = Parameters<typeof findPersonByName>[0][number];
const pessoa = (name: string, aliases: string[] = []): P => ({ id: name.toLowerCase(), name, aliases } as P);
const pessoas = [pessoa("Wesley", ["Wes"]), pessoa("Anna Clara", ["Aninha", "mãe"]), pessoa("João")];

/** O modelo fala "a Anna", "a mãe", "o Joao": achar a pessoa não pode depender de acento nem de caixa. */
describe("achar pessoa pelo nome", () => {
  it("nome exato e apelido", () => {
    expect(findPersonByName(pessoas, "Wesley")?.name).toBe("Wesley");
    expect(findPersonByName(pessoas, "aninha")?.name).toBe("Anna Clara");
    expect(findPersonByName(pessoas, "MÃE")?.name).toBe("Anna Clara");
  });

  it("sem acento e por prefixo", () => {
    expect(findPersonByName(pessoas, "joao")?.name).toBe("João");
    expect(findPersonByName(pessoas, "Anna")?.name).toBe("Anna Clara");
  });

  it("quem não existe não vira palpite", () => {
    expect(findPersonByName(pessoas, "Carlos")).toBeNull();
    expect(findPersonByName(pessoas, "")).toBeNull();
    expect(findPersonByName([], "Wesley")).toBeNull();
  });
});
