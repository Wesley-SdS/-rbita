import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@orbita/db", () => ({ db: {} }));

import { rodandoDesdeAntesDe } from "./queue";

/**
 * Como o corte de tempo dos trabalhos zumbis chega ao Postgres.
 *
 * Este teste existe por um bug que rodou calado: a comparação é
 * `coalesce(heartbeat, started, created) < corte`, e como o lado esquerdo é SQL
 * CRU (não uma coluna tipada), o Drizzle não tem o tipo para mapear o valor.
 * Com um `Date`, ele serializava por `toString()` e mandava "Sun Sep 20 2026
 * 15:56:47 GMT-0300 (Horário Padrão de Brasília)". O Postgres recusava com
 * `invalid input syntax for type timestamp`, e a recuperação de zumbis falhava
 * a CADA volta do agendador, dentro de um `catch`, sem ninguém ver.
 *
 * O efeito era o pior possível: trabalho preso porque o processo morreu nunca
 * voltava para a fila.
 *
 * Não há banco aqui: só se olha o que o Drizzle geraria.
 */
const corte = new Date("2026-09-20T18:56:47.000Z");

const parametros = () => new PgDialect().sqlToQuery(rodandoDesdeAntesDe(corte)!).params;

describe("corte de tempo dos trabalhos zumbis", () => {
  it("manda o corte em ISO, que é o que o Postgres entende", () => {
    expect(parametros()).toContain("2026-09-20T18:56:47.000Z");
  });

  it("nunca manda a data no formato local, que o Postgres recusa", () => {
    // Se alguém "simplificar" de volta para o `Date` cru, isto reprova: o
    // formato local tem nome de mês e fuso por extenso, nunca começa com ano.
    for (const p of parametros()) {
      if (p === "rodando") continue;
      expect(String(p)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("filtra por status rodando, senão recuperaria trabalho que já terminou", () => {
    expect(parametros()).toContain("rodando");
  });
});
