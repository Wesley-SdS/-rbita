import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));

const { eventoDeTerceiro } = await import("./run");

/**
 * Regra com ação `prompt` disparada por texto de TERCEIRO (mensagem de
 * WhatsApp, e-mail) roda só com tools de leitura: um "registre um gasto"
 * dentro da mensagem não pode virar lançamento no financeiro do dono.
 */
describe("eventoDeTerceiro", () => {
  it("WhatsApp e Gmail são texto de terceiro", () => {
    expect(eventoDeTerceiro({ kind: "event", type: "whatsapp.mensagem_recebida" })).toBe(true);
    expect(eventoDeTerceiro({ kind: "event", type: "gmail.important_received" })).toBe(true);
  });
  it("evento da casa e cron não são", () => {
    expect(eventoDeTerceiro({ kind: "event", type: "finance.bill_due" })).toBe(false);
    expect(eventoDeTerceiro({ kind: "cron", expr: "0 8 * * *" })).toBe(false);
    expect(eventoDeTerceiro(null)).toBe(false);
  });
});
