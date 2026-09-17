import { describe, it, expect } from "vitest";
import { eventsToWarn } from "./calendar-watch";
import type { CalEvent } from "../connectors/google";

const ev = (id: string, start = "2026-09-17T10:00:00-03:00"): CalEvent => ({ id, summary: `Evento ${id}`, start, end: "" });

describe("eventsToWarn", () => {
  it("mantém eventos com horário de início que ainda não foram avisados", () => {
    const out = eventsToWarn([ev("a"), ev("b")], new Set());
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("remove eventos já avisados", () => {
    const out = eventsToWarn([ev("a"), ev("b")], new Set(["a"]));
    expect(out.map((e) => e.id)).toEqual(["b"]);
  });

  it("ignora evento sem horário de início (dado malformado do provedor)", () => {
    const out = eventsToWarn([ev("a", "")], new Set());
    expect(out).toEqual([]);
  });

  it("lista vazia não quebra", () => {
    expect(eventsToWarn([], new Set())).toEqual([]);
  });
});
