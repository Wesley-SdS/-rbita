import { describe, expect, it, vi } from "vitest";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Retenção das sessões de controle (`controle.retencaoDias`, M9 da auditoria):
 * a sessão PAUSADA (teto, tempo, vetos) fica com `terminada_em` nulo, e a
 * faxina só olhava `terminada_em`: pausada nunca era apagada, com a trilha
 * inteira junto (cascade). A condição do DELETE é conferida no SQL que sai.
 */

const apagados: { tabela: PgTable; onde: SQL }[] = [];
vi.mock("@orbita/db", () => ({
  db: {
    delete: (tabela: PgTable) => ({ where: (onde: SQL) => ({ returning: async () => (apagados.push({ tabela, onde }), [{ id: "s1" }]) }) }),
  },
}));
vi.mock("../settings", () => ({ settings: { get: async () => 1500 } }));
vi.mock("../events/index", () => ({ events: { emit: async () => undefined } }));
vi.mock("./espelho", () => ({ espelhar: async () => [] }));

const { purgarSessoes } = await import("./sessao");
const sql = (s: SQL) => new PgDialect().sqlToQuery(s);

describe("faxina das sessões de controle", () => {
  it("apaga a terminada velha E a pausada parada há mais que a retenção; ativa nunca", async () => {
    apagados.length = 0;
    expect(await purgarSessoes(30)).toBe(1);
    const q = sql(apagados[0]!.onde);
    expect(q.sql).toMatch(/"terminada_em" is not null/);
    expect(q.sql).toMatch(/"atualizada_em" </);
    expect(q.params).toContain("pausada");
    expect(q.params).not.toContain("ativa");
    // o corte é o mesmo para as duas: hoje menos a retenção
    const datas = q.params.filter((p): p is string => typeof p === "string" && /^\d{4}-/.test(p));
    expect(datas.length).toBeGreaterThanOrEqual(2);
  });

  it("retenção zero guarda para sempre: nem consulta", async () => {
    apagados.length = 0;
    expect(await purgarSessoes(0)).toBe(0);
    expect(apagados).toEqual([]);
  });
});
