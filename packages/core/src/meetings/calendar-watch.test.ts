import { describe, it, expect } from "vitest";
import { contextoRelevante, eventsToWarn } from "./calendar-watch";
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

describe("eventsToWarn com soReunioes (lembrete de hábito não é reunião)", () => {
  const base = { summary: "x", end: "" };
  it("fica só o que tem convidado ou link de chamada, e com hora", () => {
    const eventos: CalEvent[] = [
      { ...base, id: "agua", summary: "Água +600 ml", start: "2026-09-28T10:00:00-03:00" },
      { ...base, id: "com-gente", start: "2026-09-28T10:00:00-03:00", attendees: ["Lucas"] },
      { ...base, id: "com-link", start: "2026-09-28T10:00:00-03:00", link: "https://meet.google.com/abc" },
      { ...base, id: "dia-inteiro", start: "2026-09-28", attendees: ["Lucas"] },
    ];
    expect(eventsToWarn(eventos, new Set(), { soReunioes: true }).map((e) => e.id)).toEqual(["com-gente", "com-link"]);
    // desligado, tudo que tem início continua sendo avisado
    expect(eventsToWarn(eventos, new Set(), { soReunioes: false })).toHaveLength(4);
  });
});

describe("contextoRelevante", () => {
  it("fica o trecho que cita alguém da reunião ou palavra do título, sem acento", () => {
    const ev = { summary: "Revisão do orçamento", attendees: ["Lúcas Pereira", "maria@empresa.com"] };
    const trechos = ["Ficou com o Lucas mandar a planilha", "Receita de bolo de cenoura", "O orcamento de outubro estourou", "Maria confirmou"];
    expect(contextoRelevante(ev, trechos)).toEqual(["Ficou com o Lucas mandar a planilha", "O orcamento de outubro estourou", "Maria confirmou"]);
  });

  it("nada que case: vazio (antes saía um pedaço aleatório como 'Pendente')", () => {
    expect(contextoRelevante({ summary: "Sync", attendees: ["Ana"] }, ["Receita de bolo"])).toEqual([]);
    expect(contextoRelevante({ summary: "1:1", attendees: [] }, ["qualquer coisa"])).toEqual([]);
  });
});
