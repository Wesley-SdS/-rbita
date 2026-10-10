import { describe, expect, it } from "vitest";
import { acharCard, acharColuna, moverNoQuadro, quadroDaGestao, quadroDeChamados } from "./regras";

/**
 * O quadro da Adalink, com o formato real (medido em 09/10/2026): `tickets_board`
 * com colunas por status, e a gestão nas FASES do catálogo (nunca nas três do
 * "meu dia", onde "fazendo" aponta para Planejamento).
 */

const AGORA = new Date("2026-10-09T12:00:00Z");

const board = {
  columns: [
    { status: "open", total: 6, tickets: [
      { id: "t48", code: "TCK-0048", title: "Sharepoint - Base de Conhecimento", priority: "high", organization: "Adalink", assignee: "Wesley", slaDeadline: "2026-10-03T19:49:25Z", slaPaused: false },
      { id: "t1", code: "TCK-0001", title: "Solicitação de conector: CV CRM", priority: "medium", organization: "Concretiza", assignee: null, slaDeadline: null, slaPaused: false },
    ] },
    { status: "in_progress", total: 0, tickets: [] },
    { status: "waiting", total: 1, tickets: [{ id: "t53", code: "TCK-0053", title: "Conector Trello", priority: "critical", organization: "Adalink", assignee: "Wesley", slaDeadline: "2026-10-06T23:00:00Z", slaPaused: true }] },
    { status: "resolved", total: 1, tickets: [{ id: "t3", code: "TCK-0003", title: "MCP da Geagro", priority: "high", organization: "Adalink", assignee: "Wesley", slaDeadline: "2026-09-22T02:31:01Z", slaPaused: false }] },
  ],
};

describe("quadro de chamados", () => {
  const q = quadroDeChamados(board, "Wesley Santos", AGORA);

  it("as cinco colunas da central, na ordem, mesmo a que não veio", () => {
    expect(q.colunas.map((c) => c.rotulo)).toEqual(["Aberto", "Em andamento", "Aguardando", "Resolvido", "Fechado"]);
    expect(q.colunas[4]).toMatchObject({ id: "closed", total: 0, cards: [] });
  });

  it("o total é o da central, mesmo com a lista cortada", () => {
    expect(q.colunas[0]).toMatchObject({ total: 6 });
    expect(q.colunas[0]!.cards).toHaveLength(2);
  });

  it("o card leva código, prioridade, dono, prazo do SLA; pausado e resolvido não correm", () => {
    expect(q.colunas[0]!.cards[0]).toMatchObject({ codigo: "TCK-0048", prioridade: "alta", comVoce: true, responsaveis: ["Wesley"], prazo: { estado: "atrasado" } });
    expect(q.colunas[0]!.cards[1]).toMatchObject({ comVoce: false, responsaveis: [], prazo: { estado: "sem_prazo" } });
    expect(q.colunas[2]!.cards[0]).toMatchObject({ critico: true, prazo: { estado: "pausado" } });
    expect(q.colunas[3]!.cards[0]!.prazo).toBeNull();
  });

  it("retorno torto vira quadro vazio, não erro", () => {
    expect(quadroDeChamados(null, "x", AGORA).colunas.every((c) => c.cards.length === 0)).toBe(true);
  });
});

describe("quadro da gestão", () => {
  const fases = [{ id: "f-back", label: "Backlog" }, { id: "f-plan", label: "Planejamento" }, { id: "f-dev", label: "Desenvolvimento" }, { id: "f-hom", label: "Homologação" }, { id: "f-ok", label: "Concluido" }];
  const atividades = [
    { id: "a1", name: "Adequação da geração de ppt", projectName: "Implantação", companyName: "Althaia", companyColor: "#7C3AED", startDate: "2026-09-10", endDate: "2026-10-26", isCritical: true, estimatedHours: 30, realizadoTotal: 4, responsibles: [{ name: "Wesley Santos", isMe: true }, { name: "Marcela Santoro", isMe: false }], phase: "f-plan" },
    { id: "a2", name: "Levantamento de requisitos", projectName: "Sistema de Bugs", companyName: "Adalink", endDate: "2026-09-17", responsibles: [], phase: "f-dev" },
    { id: "a1", name: "duplicada no meu dia", phase: "f-plan" },
    { id: "a9", name: "Fase que o catálogo não tem", phase: "f-xyz" },
  ];
  const q = quadroDaGestao(fases, atividades, AGORA);

  it("as colunas são as fases do catálogo, e cada atividade fica na fase dela", () => {
    expect(q.colunas.map((c) => c.rotulo)).toEqual(["Backlog", "Planejamento", "Desenvolvimento", "Homologação", "Concluido", "Outra fase"]);
    expect(q.colunas[1]!.cards.map((c) => c.id)).toEqual(["a1"]);
    expect(q.colunas[2]!.cards[0]).toMatchObject({ titulo: "Levantamento de requisitos", prazo: { estado: "atrasado" } });
  });

  it("o card leva projeto, cor da empresa, horas, crítico e quem está junto", () => {
    expect(q.colunas[1]!.cards[0]).toMatchObject({ subtitulo: "Implantação · Althaia", cor: "#7C3AED", critico: true, horas: { feitas: 4, previstas: 30 }, responsaveis: ["Wesley Santos", "Marcela Santoro"], comVoce: true });
  });

  it("fase desconhecida não some: vai para \"Outra fase\", que não é destino de mover", () => {
    expect(q.colunas[5]!.cards.map((c) => c.id)).toEqual(["a9"]);
    expect(acharColuna(q, "outra fase").ok).toBe(false);
  });
});

describe("mover e achar", () => {
  const q = quadroDeChamados(board, "Wesley", AGORA);

  it("mover tira da coluna de origem, põe no topo do destino e acerta os totais", () => {
    const m = moverNoQuadro(q, "t48", "in_progress");
    expect(m.colunas[0]).toMatchObject({ total: 5 });
    expect(m.colunas[0]!.cards.map((c) => c.id)).toEqual(["t1"]);
    expect(m.colunas[1]).toMatchObject({ total: 1 });
    expect(m.colunas[1]!.cards[0]!.id).toBe("t48");
    // coluna inexistente ou a mesma: nada muda
    expect(moverNoQuadro(q, "t48", "nao-existe")).toBe(q);
    expect(moverNoQuadro(q, "t48", "open")).toBe(q);
  });

  it("o card pelo código como se fala (\"48\", \"tck 48\") ou por parte do título", () => {
    expect(acharCard(q, "TCK-0048")).toMatchObject({ ok: true, valor: { id: "t48", coluna: "Aberto" } });
    expect(acharCard(q, "48")).toMatchObject({ ok: true, valor: { id: "t48" } });
    expect(acharCard(q, "trello")).toMatchObject({ ok: true, valor: { id: "t53" } });
    expect(acharCard(q, "conector")).toMatchObject({ ok: false, erro: expect.stringContaining("Mais de um") });
    expect(acharCard(q, "inexistente")).toMatchObject({ ok: false });
  });

  it("a coluna pelo nome falado, sem acento nem caixa", () => {
    expect(acharColuna(q, "em andamento")).toMatchObject({ ok: true, valor: { id: "in_progress" } });
    expect(acharColuna(q, "Resolvido")).toMatchObject({ ok: true, valor: { id: "resolved" } });
    expect(acharColuna(q, "aguarda")).toMatchObject({ ok: true, valor: { id: "waiting" } });
    expect(acharColuna(q, "lixeira")).toMatchObject({ ok: false, erro: expect.stringContaining("Aberto, Em andamento") });
  });
});
