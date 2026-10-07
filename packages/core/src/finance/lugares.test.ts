import { describe, expect, it } from "vitest";
import { lugarDaDescricao } from "./lugares";

describe("o lugar de cada lançamento", () => {
  it("as descrições reais do extrato de 05/10/2026", () => {
    expect(lugarDaDescricao("Pix Pjbank")).toBe("Pjbank");
    expect(lugarDaDescricao("Pagamento boleto Credsystem Instituicao Pa")).toBe("Credsystem");
    expect(lugarDaDescricao("Pagamento boleto Habitacional Comercial Lt")).toBe("Habitacional");
    expect(lugarDaDescricao("Pix enviado Eliane Dos Anjos Santana")).toBe("Eliane Dos Anjos Santana");
    expect(lugarDaDescricao("Pagamento boleto Banco Santander Brasil")).toBe("Banco Santander");
  });

  it("a mesma marca escrita de jeitos diferentes soma junto", () => {
    for (const d of ["IFOOD *BK BRASIL", "iFood *Habibs", "Ifd*Restaurante Sabor", "PAG*IFOOD"]) expect(lugarDaDescricao(d)).toBe("iFood");
    expect(lugarDaDescricao("UBER *TRIP HELP.UBER.COM")).toBe("Uber");
    expect(lugarDaDescricao("UBER *EATS")).toBe("Uber Eats");
    expect(lugarDaDescricao("AMZN Mktp BR")).toBe("Amazon");
    expect(lugarDaDescricao("POSTO SHELL 1234 SAO PAULO")).toBe("Posto Shell");
  });

  it("a processadora antes do * cede o lugar ao estabelecimento", () => {
    expect(lugarDaDescricao("PAG*PADARIA BELA VISTA")).toBe("Padaria Bela Vista");
    expect(lugarDaDescricao("SUMUP *CAFE DO PONTO 0042")).toBe("Cafe do Ponto");
    expect(lugarDaDescricao("BURGER KING*SHOPPING ELDORADO")).toBe("Burger King");
  });

  it("código, cidade e razão social saem; caixa mista é respeitada", () => {
    expect(lugarDaDescricao("RESTAURANTE SABOR DE CASA LTDA 12/10")).toBe("Restaurante Sabor de Casa");
    expect(lugarDaDescricao("Academia SmartFit")).toBe("Academia SmartFit");
    expect(lugarDaDescricao("  ")).toBe("Sem descrição");
    expect(lugarDaDescricao(null)).toBe("Sem descrição");
    expect(lugarDaDescricao("Pix 123456")).toBe("Sem descrição");
  });

  it("nome muito comprido é cortado", () => {
    expect(lugarDaDescricao("Compra no débito Loja de Materiais de Construção e Acabamentos Finos Unidade Centro").length).toBeLessThanOrEqual(40);
  });
});

describe("gasto por lugar, mês a mês", () => {
  it("soma as compras do mesmo lugar, ignora transferência e abate estorno", async () => {
    const { gastoPorLugar } = await import("./mes");
    const l = (data: string, valor: number, descricao: string, extra: Record<string, unknown> = {}) => ({ id: `${data}${descricao}${valor}`, tipo: "despesa" as const, data, valor, descricao, ...extra });
    const r = gastoPorLugar(
      [
        l("2026-09-03", 4500, "IFOOD *BK BRASIL"),
        l("2026-10-01", 5200, "iFood *Habibs"),
        l("2026-10-02", 3000, "Ifd*Sabor"),
        l("2026-10-05", 30000, "Pagamento boleto Banco Santander Brasil"),
        l("2026-10-06", 100000, "Transferência para poupança", { transferencia: true }),
        { id: "e", tipo: "receita" as const, data: "2026-10-07", valor: 1200, descricao: "Estorno iFood", estorno: true },
        l("2026-08-01", 9999, "IFOOD *FORA DO PERÍODO"),
      ],
      ["2026-09", "2026-10"],
    );
    expect(r).toEqual([
      { lugar: "Banco Santander", total: 30000, vezes: 1, porMes: [0, 30000] },
      { lugar: "iFood", total: 11500, vezes: 3, porMes: [4500, 7000] },
    ]);
  });
});
