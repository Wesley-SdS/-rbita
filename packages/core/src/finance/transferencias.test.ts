import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("../settings", () => ({ settings: { get: async () => 2 } }));

const { sugerirPares } = await import("./transferencias");

const l = (id: string, tipo: "despesa" | "receita", data: string, valor: number, contaId: string) => ({ id, tipo, data, valor, descricao: null, contaId });

describe("sugerirPares", () => {
  it("saída numa conta e entrada de mesmo valor na outra, no mesmo dia, formam um par", () => {
    const r = sugerirPares([l("s", "despesa", "2026-10-09", 50000, "A"), l("e", "receita", "2026-10-09", 50000, "B")], 2);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ saida: { id: "s" }, entrada: { id: "e" }, dias: 0 });
  });

  it("respeita a janela de dias", () => {
    const base = [l("s", "despesa", "2026-10-09", 50000, "A")];
    expect(sugerirPares([...base, l("e", "receita", "2026-10-11", 50000, "B")], 2)).toHaveLength(1);
    expect(sugerirPares([...base, l("e", "receita", "2026-10-12", 50000, "B")], 2)).toHaveLength(0);
  });

  it("CONTROLE: mesma conta, valor diferente ou o mesmo sentido não são par", () => {
    expect(sugerirPares([l("s", "despesa", "2026-10-09", 50000, "A"), l("e", "receita", "2026-10-09", 50000, "A")], 2)).toHaveLength(0);
    expect(sugerirPares([l("s", "despesa", "2026-10-09", 50000, "A"), l("e", "receita", "2026-10-09", 49999, "B")], 2)).toHaveLength(0);
    expect(sugerirPares([l("s", "despesa", "2026-10-09", 50000, "A"), l("e", "despesa", "2026-10-09", 50000, "B")], 2)).toHaveLength(0);
  });

  it("o par mais próximo escolhe primeiro, e cada lançamento entra em um par só", () => {
    const r = sugerirPares([
      l("s1", "despesa", "2026-10-09", 10000, "A"),
      l("e-longe", "receita", "2026-10-11", 10000, "B"),
      l("e-perto", "receita", "2026-10-09", 10000, "B"),
    ], 2);
    expect(r).toHaveLength(1);
    expect(r[0]!.entrada.id).toBe("e-perto");
  });

  it("o que o banco disse ter um terceiro do outro lado fica de fora", () => {
    const ls = [l("s", "despesa", "2026-10-09", 7700, "A"), l("e", "receita", "2026-10-09", 7700, "B")];
    expect(sugerirPares(ls, 2, new Set(["e"]))).toHaveLength(0);
    expect(sugerirPares(ls, 2, new Set())).toHaveLength(1);
  });
});
