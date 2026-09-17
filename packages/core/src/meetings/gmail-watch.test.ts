import { describe, it, expect } from "vitest";
import { newImportantMessages } from "./gmail-watch";
import type { ImportantEmail } from "../connectors/google";

const msg = (id: string, at: string): ImportantEmail => ({ id, from: "a@b.com", subject: `Assunto ${id}`, snippet: "", internalDate: new Date(at) });

describe("newImportantMessages", () => {
  it("primeira volta (sem cursor salvo): não inunda com o histórico", () => {
    const out = newImportantMessages([msg("1", "2026-09-16T10:00:00Z")], null);
    expect(out).toEqual([]);
  });

  it("mantém só mensagens mais novas que o cursor", () => {
    const since = new Date("2026-09-16T10:00:00Z");
    const out = newImportantMessages(
      [msg("velha", "2026-09-16T09:00:00Z"), msg("nova", "2026-09-16T11:00:00Z")],
      since,
    );
    expect(out.map((m) => m.id)).toEqual(["nova"]);
  });

  it("mensagem exatamente no cursor não é repetida (estritamente maior)", () => {
    const since = new Date("2026-09-16T10:00:00Z");
    expect(newImportantMessages([msg("x", "2026-09-16T10:00:00Z")], since)).toEqual([]);
  });

  it("lista vazia não quebra", () => {
    expect(newImportantMessages([], new Date())).toEqual([]);
  });
});
