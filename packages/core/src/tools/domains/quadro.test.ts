import { describe, expect, it, vi } from "vitest";

/**
 * Quadro pelo chat e pela voz (CLAUDE.md §5.1 e §5.7): ver é leitura; mover é
 * efeito externo, vira proposta, e o card e a coluna da proposta são fixados
 * pelo código. Pedido ambíguo é recusado antes de chegar à fila.
 */

const movidos: unknown[] = [];

vi.mock("../../quadro/servico", async () => {
  const { quadroDeChamados } = await import("../../quadro/regras");
  const quadro = quadroDeChamados(
    { columns: [
      { status: "open", total: 2, tickets: [{ id: "t48", code: "TCK-0048", title: "Sharepoint", assignee: "Wesley", priority: "high", slaDeadline: "2026-10-03T19:49:25Z" }, { id: "t1", code: "TCK-0001", title: "Conector CV CRM" }] },
      { status: "waiting", total: 1, tickets: [{ id: "t53", code: "TCK-0053", title: "Conector Trello", assignee: "Wesley" }] },
    ] },
    "Wesley",
    new Date("2026-10-09T12:00:00Z"),
  );
  return {
    lerQuadro: async () => quadro,
    moverCard: async (_u: string, qual: string, cardId: string, colunaId: string) => {
      movidos.push({ qual, cardId, colunaId });
      return { card: "TCK-0048 Sharepoint", coluna: "Em andamento" };
    },
  };
});

const { getTool } = await import("../registry");
await import("./quadro");
const { cartoesDoResultado } = await import("../../chat/cartoes-da-tela");
const ctx = { userId: "u1" } as never;

describe("ver o quadro", () => {
  it("é leitura e vira cartão com uma aba por coluna", async () => {
    const t = getTool("ver_quadro")!;
    expect(t.risk).toBe("leitura");
    const r = await t.run({ quadro: "chamados" }, ctx);
    const [c] = cartoesDoResultado("ver_quadro", r);
    expect(c!.grupos!.map((g) => `${g.rotulo}:${g.total}`)).toEqual(["Aberto:2", "Em andamento:0", "Aguardando:1", "Resolvido:0", "Fechado:0"]);
    expect(c!.itens[0]).toMatchObject({ titulo: "TCK-0048 · Sharepoint", marca: "atrasado" });
  });
});

describe("mover pelo chat e pela voz", () => {
  const t = () => getTool("mover_card")!;

  it("é efeito externo: só propõe, o dono aprova", () => {
    expect(t().risk).toBe("efeito_externo");
  });

  it("pedido ambíguo, coluna desconhecida ou card que já está lá são recusados antes da fila", async () => {
    expect(await t().authorize!({ quadro: "chamados", card: "conector", para: "em andamento" }, ctx)).toContain("Mais de um");
    expect(await t().authorize!({ quadro: "chamados", card: "48", para: "lixeira" }, ctx)).toContain("Não sei qual coluna");
    expect(await t().authorize!({ quadro: "chamados", card: "TCK-0053", para: "aguardando" }, ctx)).toContain("já está");
    expect(await t().authorize!({ quadro: "chamados", card: "48", para: "em andamento" }, ctx)).toBeNull();
  });

  it("o alvo é fixado pelo código ao propor, por cima do que o modelo mandou, e é o que o resumo mostra", async () => {
    const fixo = await t().preparar!({ quadro: "chamados", card: "48", para: "andamento", card_id: "t1", coluna_id: "closed" }, ctx);
    expect(fixo).toMatchObject({ card_id: "t48", coluna_id: "in_progress", card_nome: "TCK-0048 Sharepoint", coluna_nome: "Em andamento" });
    expect(t().summarize!(fixo)).toBe('Mover TCK-0048 Sharepoint para "Em andamento" no quadro de chamados');
  });

  it("depois de aprovado, move exatamente o que foi fixado", async () => {
    const r = await t().run({ quadro: "chamados", card: "48", para: "andamento", card_id: "t48", coluna_id: "in_progress" }, ctx);
    expect(movidos).toEqual([{ qual: "chamados", cardId: "t48", colunaId: "in_progress" }]);
    expect(r).toBe('Movi TCK-0048 Sharepoint para "Em andamento".');
  });
});

describe("o quadro cru da central vira o mesmo cartão", () => {
  it("tickets_board (escolhido pelo modelo para \"como estão os chamados\") abre o quadro, não um cartão genérico", () => {
    const conteudo = [{ type: "text", text: JSON.stringify({ columns: [{ status: "open", total: 1, tickets: [{ id: "t1", code: "TCK-0001", title: "Conector CV CRM" }] }, { status: "waiting", total: 1, tickets: [{ id: "t53", code: "TCK-0053", title: "Trello", assignee: "Wesley", slaPaused: true }] }] }) }];
    const [c] = cartoesDoResultado("tickets__tickets_board", conteudo);
    expect(c!.id).toBe("quadro:chamados");
    expect(c!.grupos!.map((g) => `${g.rotulo}:${g.total}`)).toEqual(["Aberto:1", "Em andamento:0", "Aguardando:1", "Resolvido:0", "Fechado:0"]);
    // e na voz, embrulhado pela função de MCP, também
    const [v] = cartoesDoResultado("usar_ferramenta_externa", { ferramenta: "tickets__tickets_board", resultado: conteudo[0]!.text });
    expect(v!.id).toBe("quadro:chamados");
  });
});
