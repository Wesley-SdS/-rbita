import { describe, expect, it } from "vitest";
import { arrumarResultado } from "./resultado-da-acao";

/** O resultado da ação aprovada, sem URL gigante no cartão (28/09/2026). */
describe("arrumarResultado", () => {
  it("evento do Google: a conta vira etiqueta e a URL vira 'Abrir na agenda'", () => {
    expect(arrumarResultado("Evento criado na agenda de wesleysantos.0095@gmail.com: https://www.google.com/calendar/event?eid=OHVtMWtj")).toEqual({
      texto: "Evento criado.",
      conta: "wesleysantos.0095@gmail.com",
      links: [{ url: "https://www.google.com/calendar/event?eid=OHVtMWtj", rotulo: "Abrir na agenda" }],
    });
  });

  it("e-mail enviado pela conta: etiqueta, sem link", () => {
    expect(arrumarResultado("E-mail enviado pela conta joao@empresa.com (id 18c2f)")).toEqual({ texto: "E-mail enviado (id 18c2f).", conta: "joao@empresa.com", links: [] });
  });

  it("texto sem conta nem URL passa como está", () => {
    expect(arrumarResultado("Áudio enviado (id 3EB080C0).")).toEqual({ texto: "Áudio enviado (id 3EB080C0).", conta: null, links: [] });
    expect(arrumarResultado(undefined)).toEqual({ texto: "", conta: null, links: [] });
  });
});
