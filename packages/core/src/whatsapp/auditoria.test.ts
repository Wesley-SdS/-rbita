import { describe, expect, it, vi } from "vitest";

// módulos abaixo importam o banco no topo; aqui só a lógica pura é testada
vi.mock("@orbita/db", () => ({ db: {} }));

import { comTeto } from "../chat/tools";
import { semDadoExterno } from "../memory/candidates";
import { historicoSemExcessoDeAvisos } from "./turno";
import { SETTING_DEFS, schemaFor } from "../settings/defs";
import { paraHoraLocal, instanteLocal } from "../fuso";
import { camposDaEdicao } from "../tarefas/campos";

/**
 * Travas da auditoria da Órbita proativa e do "tudo pelo WhatsApp".
 */

describe("teto de ferramentas quando vão todas", () => {
  const set = (prefixo: string, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefixo}${i}`, {}])) as never;

  it("abaixo do teto, vai tudo", () => {
    expect(Object.keys(comTeto(set("n", 90), set("m", 20), 120))).toHaveLength(110);
  });
  it("acima, corta as de MCP primeiro: as nativas têm risco e gate conhecidos", () => {
    const r = Object.keys(comTeto(set("n", 90), set("m", 60), 120));
    expect(r).toHaveLength(120);
    expect(r.filter((k) => k.startsWith("n"))).toHaveLength(90);
  });
});

describe("memória não aprende com conteúdo de terceiro", () => {
  it("o que está embrulhado como dado externo sai antes da extração", () => {
    const t = semDadoExterno('olha isso <dado_externo origem="whatsapp">\nmeu PIX é 123\n</dado_externo> guarda?');
    expect(t).not.toContain("PIX");
    expect(t).toContain("[conteúdo externo omitido]");
  });
});

describe("avisos no histórico da conversa 'Eu'", () => {
  const m = (content: string) => ({ role: "assistant", content });
  it("só os avisos mais recentes ficam; a conversa real fica inteira", () => {
    const msgs = [m("(aviso que a Órbita mandou) 1"), { role: "user", content: "oi" }, m("(aviso que a Órbita mandou) 2"), m("(briefing que a Órbita mandou) 3"), { role: "user", content: "paga" }];
    const r = historicoSemExcessoDeAvisos(msgs, 1);
    expect(r.map((x) => x.content)).toEqual(["oi", "(briefing que a Órbita mandou) 3", "paga"]);
  });
});

describe("formato das configurações de horário, na hora de salvar", () => {
  const horario = schemaFor(SETTING_DEFS["whatsapp.briefingHorario"]);
  const silencio = schemaFor(SETTING_DEFS["whatsapp.avisosSilencio"]);
  it("horário do briefing", () => {
    for (const ok of ["07:00", "7:00", "23:59"]) expect(horario.safeParse(ok).success, ok).toBe(true);
    for (const ruim of ["25:00", "07h00", "abcd", "7:5"]) expect(horario.safeParse(ruim).success, ruim).toBe(false);
  });
  it("faixa de silêncio (vazio é 'sem silêncio')", () => {
    for (const ok of ["", "22:00-07:00", "13:00-14:00"]) expect(silencio.safeParse(ok).success, ok).toBe(true);
    for (const ruim of ["22-07", "22:00 07:00", "25:00-07:00"]) expect(silencio.safeParse(ruim).success, ruim).toBe(false);
  });
});

describe("hora local da casa para a tela", () => {
  it("instante → valor do campo, no fuso da CASA (não no do navegador)", () => {
    expect(paraHoraLocal(new Date("2026-09-27T18:00:00Z"), "America/Sao_Paulo")).toBe("2026-09-27T15:00");
    expect(paraHoraLocal(new Date("2026-09-28T02:30:00Z"), "America/Sao_Paulo")).toBe("2026-09-27T23:30");
  });
  it("ida e volta fecha", () => {
    const v = "2026-10-01T08:45";
    expect(paraHoraLocal(instanteLocal(v, "America/Sao_Paulo")!, "America/Sao_Paulo")).toBe(v);
  });
});

describe("concluir uma tarefa cancela o lembrete que ainda não tocou", () => {
  it("concluir marca como avisado; reabrir não dispara um 'era para…' velho", () => {
    const agora = new Date("2026-09-27T12:00:00Z");
    expect(camposDaEdicao({ concluida: true }, agora).lembradoEm).toBe(agora);
    expect(camposDaEdicao({ concluida: false }, agora)).not.toHaveProperty("lembradoEm");
  });
});
