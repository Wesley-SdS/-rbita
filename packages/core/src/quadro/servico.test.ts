import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ler e mover no quadro da Adalink. O que fica travado: a gestão lê a fase de
 * cada atividade no detalhe dela; mover confere card e coluna no quadro lido
 * AGORA antes de chamar o sistema; e cada quadro chama a ferramenta certa.
 */

const chamadas: { tool: string; args: Record<string, unknown> }[] = [];
const escritas: { tool: string; args: Record<string, unknown> }[] = [];

vi.mock("@orbita/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ name: "Wesley Santos" }] }) }) }) } }));
vi.mock("../settings", () => ({
  settings: {
    get: async (k: string) => ({ "comigo.cacheSegundos": 60, "comigo.meuNome": "", "comigo.servidorTickets": "tickets", "comigo.servidorGestao": "adalink-gestao", "mcp.catalogRefreshHours": 24, "comigo.detalhesEmParalelo": 2 })[k],
    getMany: async () => ({ "connectors.fusoHorario": "America/Sao_Paulo", "comigo.pertoPercentual": 25, "comigo.pertoHoras": 24 }),
  },
}));
vi.mock("../mcp/client", () => ({
  lerFerramentaMcp: async (_u: string, _s: string, tool: string, args: Record<string, unknown> = {}) => {
    chamadas.push({ tool, args });
    if (tool === "tickets_board") return { columns: [{ status: "open", total: 1, tickets: [{ id: "t48", code: "TCK-0048", title: "Sharepoint", assignee: "Wesley", priority: "high" }] }] };
    if (tool === "list_catalogs") return { items: [{ id: "f-dev", label: "Desenvolvimento", sortOrder: 2 }, { id: "f-back", label: "Backlog", sortOrder: 1 }, { id: "f-hom", label: "Homologação", sortOrder: 3 }] };
    if (tool === "get_my_day") return { phaseIds: { doing: "f-plan" }, doing: [{ id: "a1", name: "Relatório", projectName: "Painel" }, { id: "a2", name: "Requisitos", projectName: "Bugs" }], doneToday: [], backlog: [] };
    if (tool === "get_activity") return { phase: args.activityId === "a1" ? "f-dev" : "f-back" };
    return null;
  },
  chamarFerramentaMcpPeloDono: async (_u: string, _s: string, tool: string, args: Record<string, unknown>) => {
    escritas.push({ tool, args });
  },
}));

const { lerQuadro, moverCard } = await import("./servico");

beforeEach(() => {
  chamadas.length = 0;
  escritas.length = 0;
});

describe("ler o quadro", () => {
  it("chamados vem do tickets_board, e o dono é reconhecido pelo nome da conta", async () => {
    const q = await lerQuadro("u-ler-1", "chamados", { fresco: true });
    expect(chamadas.map((c) => c.tool)).toEqual(["tickets_board"]);
    expect(q.colunas[0]!.cards[0]).toMatchObject({ codigo: "TCK-0048", comVoce: true });
  });

  it("gestão: fases na ordem do catálogo, e a fase de cada atividade vem do detalhe dela", async () => {
    const q = await lerQuadro("u-ler-2", "gestao", { fresco: true });
    expect(q.colunas.map((c) => c.rotulo)).toEqual(["Backlog", "Desenvolvimento", "Homologação"]);
    expect(q.colunas[1]!.cards.map((c) => c.id)).toEqual(["a1"]);
    expect(q.colunas[0]!.cards.map((c) => c.id)).toEqual(["a2"]);
    expect(chamadas.filter((c) => c.tool === "get_activity").map((c) => c.args.activityId)).toEqual(["a1", "a2"]);
  });
});

describe("mover", () => {
  it("chamado: muda o status na central, pelo id", async () => {
    const r = await moverCard("u-mover-1", "chamados", "t48", "in_progress");
    expect(escritas).toEqual([{ tool: "tickets_update", args: { ticket: "t48", status: "in_progress" } }]);
    expect(r).toEqual({ card: "TCK-0048 Sharepoint", coluna: "Em andamento" });
  });

  it("atividade: muda a FASE na gestão (nunca a coluna do \"meu dia\")", async () => {
    await moverCard("u-mover-2", "gestao", "a1", "f-hom");
    expect(escritas).toEqual([{ tool: "update_activity_status", args: { activityId: "a1", phase: "f-hom" } }]);
  });

  it("card ou coluna que não existem no quadro de agora não chegam ao sistema", async () => {
    await expect(moverCard("u-mover-3", "chamados", "t999", "open")).rejects.toThrow(/não está mais/);
    await expect(moverCard("u-mover-3", "gestao", "a1", "f-plan")).rejects.toThrow(/coluna não existe/);
    expect(escritas).toEqual([]);
  });

  it("depois de mover, a leitura seguinte já mostra o card no lugar novo", async () => {
    await moverCard("u-mover-4", "chamados", "t48", "waiting");
    const q = await lerQuadro("u-mover-4", "chamados");
    expect(q.colunas.find((c) => c.id === "waiting")!.cards.map((c) => c.id)).toEqual(["t48"]);
  });
});
