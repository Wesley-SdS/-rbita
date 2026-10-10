import { describe, expect, it, vi } from "vitest";

/**
 * "O que está comigo?" (CLAUDE.md §5.7): a mesma visão do painel, num cartão
 * com uma aba para o que é do dono e uma para cada tipo de atraso da equipe.
 * Sem os servidores ligados, ela diz onde ligar em vez de responder vazio.
 */

let partes = { gestao: true, tickets: true };

vi.mock("../../comigo/servico", () => ({
  comigoDe: async () => ({
    partes,
    atividades: [{ id: "a1", titulo: "Levantamento de requisitos", projeto: "Sistema de Bugs", empresa: "Adalink", coluna: "Em andamento", fim: "2026-09-17", atrasada: true, critica: false, com: ["William"], prazo: { estado: "atrasado", quando: "2026-09-17", texto: "venceu há 21 dias, em 17/09", restanteMs: -1 } }],
    chamados: {
      comigo: [{ id: "t1", codigo: "TCK-0053", titulo: "Trello", status: "aberto", prioridade: "alta", responsavel: "Wesley", organizacao: "Adalink", prazo: "2026-10-06T23:05:47Z", vencidoEm: "2026-10-06T23:05:47Z", motivo: "prazo" }],
      semTratativa: [{ id: "t2", codigo: "TCK-0047", titulo: "Erro ao gerar artefato", status: "aberto", prioridade: "alta", responsavel: null, organizacao: "Adalink", prazo: "2026-10-01T03:01:02Z", vencidoEm: "2026-10-01T03:01:02Z", motivo: "prazo" }],
      comDevAtrasados: [{ id: "t3", codigo: "TCK-0050", titulo: "Lentidão", status: "em andamento", prioridade: "média", responsavel: "Fernando Rodrigues", organizacao: "Benx", prazo: "2026-10-07T16:17:07Z", vencidoEm: "2026-10-07T16:17:07Z", motivo: "prazo", prazoSolucao: { estado: "atrasado", texto: "venceu ontem às 13:17" }, primeiraResposta: { estado: "atrasado", texto: "venceu há 5 dias, em 03/10" } }],
    },
    falhas: [],
    lidoEm: "2026-10-08T12:00:00Z",
  }),
}));

const { toToolSet, getTool } = await import("../registry");
await import("./comigo");
const { cartoesDoResultado } = await import("../../chat/cartoes-da-tela");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const gate = { enqueue: async () => ({ id: "a" }) } as unknown as Parameters<typeof toToolSet>[2];
const executar = () => (toToolSet([getTool("o_que_esta_comigo")!], ctx, gate).o_que_esta_comigo as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute({}, { toolCallId: "c", messages: [] }) as Promise<Record<string, unknown>>;

describe("o que está comigo", () => {
  it("é leitura (executa direto) e devolve o que é do dono e os atrasos da equipe", async () => {
    expect(getTool("o_que_esta_comigo")!.risk).toBe("leitura");
    const r = await executar();
    expect((r.atividades_comigo as unknown[]).length).toBe(1);
    expect((r.atrasados_com_desenvolvedor as { responsavel: string }[])[0]!.responsavel).toBe("Fernando Rodrigues");
  });

  it("vira um cartão com três abas, e o atraso aparece marcado", async () => {
    const [c] = cartoesDoResultado("o_que_esta_comigo", await executar());
    expect(c!.grupos).toEqual([
      { id: "comigo", rotulo: "Com você", total: 2 },
      { id: "sem_tratativa", rotulo: "Sem tratativa", total: 1 },
      { id: "dev_atrasado", rotulo: "Com dev, atrasados", total: 1 },
    ]);
    expect(c!.resumo).toBe("2 itens com você · 2 chamados atrasados");
    expect(c!.itens.find((i) => i.grupo === "dev_atrasado")).toMatchObject({ titulo: "TCK-0050 · Lentidão", detalhe: "em andamento · com Fernando Rodrigues · Benx", marca: "atrasado" });
    expect(c!.itens.find((i) => i.grupo === "comigo" && i.titulo === "Levantamento de requisitos")).toMatchObject({ marca: "atrasado", quando: "2026-09-17", texto: "Prazo para finalizar: venceu há 21 dias, em 17/09" });
    // o chamado leva os DOIS prazos do SLA, como a tela
    expect(c!.itens.find((i) => i.grupo === "dev_atrasado")!.texto).toBe("Prazo do SLA: venceu ontem às 13:17 · 1ª resposta: venceu há 5 dias, em 03/10");
  });

  it("sem os servidores ligados, diz onde ligar", async () => {
    partes = { gestao: false, tickets: false };
    expect(await executar()).toMatchObject({ erro: expect.stringContaining("Extensões") });
    partes = { gestao: true, tickets: true };
  });
});
