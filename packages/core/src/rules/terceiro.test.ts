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

  // I13 da auditoria de 11/10/2026: a lista era de TERCEIROS (só whatsapp e gmail), e todo
  // evento novo nascia confiável. Agora a lista é de CONFIÁVEIS, e o resto é de terceiro.
  it("convite de reunião e resultado de ação levam texto de fora: são de terceiro", () => {
    expect(eventoDeTerceiro({ kind: "event", type: "calendar.meeting_upcoming" })).toBe(true);
    expect(eventoDeTerceiro({ kind: "event", type: "action.executed" })).toBe(true);
    expect(eventoDeTerceiro({ kind: "event", type: "mcp.tool_executed" })).toBe(true);
    expect(eventoDeTerceiro({ kind: "event", type: "job.finished" })).toBe(true);
    expect(eventoDeTerceiro({ kind: "event", type: "terminal.comando_terminado" })).toBe(true);
  });
  it("evento que ninguém classificou é de terceiro (falha fechada)", () => {
    expect(eventoDeTerceiro({ kind: "event", type: "outlook.novo_evento_que_ainda_nao_existe" })).toBe(true);
    expect(eventoDeTerceiro({ kind: "event" })).toBe(true);
  });
  it("controle: os do sistema e da casa continuam confiáveis (a regra pode escrever)", () => {
    for (const t of ["identity.seen", "identity.presence_changed", "identity.gesture", "connector.refresh_failed", "whatsapp.sessao_caiu", "whatsapp.sessao_voltou", "account.exported", "owner.transferred"]) {
      expect(eventoDeTerceiro({ kind: "event", type: t })).toBe(false);
    }
  });
});
