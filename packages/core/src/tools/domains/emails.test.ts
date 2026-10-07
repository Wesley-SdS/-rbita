import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools dos e-mails triados (CLAUDE.md §5.7). O que fica travado: a
 * consulta devolve as abas no formato que vira o cartão com abas, pedir uma
 * aba só lê aquela, e atualizar enfileira UMA leitura (dedup).
 */

const pedidas: string[] = [];
const enfileirados: unknown[] = [];

vi.mock("../../emails/servico", () => ({
  emailsDe: async (_u: string, aba: string) => {
    pedidas.push(aba);
    return {
      caixas: 3,
      contagem: { acao: 1, util: 1, ruido: 0 },
      itens:
        aba === "acao"
          ? [{ id: "e1", de: "Stripe <no-reply@stripe.com>", assunto: "Envie o documento", resumo: "A Stripe pede o documento.", trecho: "", recebidoEm: new Date("2026-10-06T10:00:00Z"), conta: "pessoal", oQueFazer: "Enviar o documento à Stripe", prazo: "2026-10-22", tarefaId: "t1", movimentacao: null, lancamento: null, link: "https://mail.google.com/mail/#all/1" }]
          : aba === "util"
            ? [{ id: "e2", de: "Nubank <todomundo@nubank.com.br>", assunto: "Pix recebido", resumo: null, trecho: "Você recebeu", recebidoEm: new Date("2026-10-06T11:00:00Z"), conta: "pessoal", oQueFazer: null, prazo: null, tarefaId: null, movimentacao: { natureza: "receita", valor: 15000, contraparte: "Ana" }, lancamento: "lancado", link: null }]
            : [],
    };
  },
}));
vi.mock("../../jobs/queue", () => ({
  enqueueJob: async (_u: string, j: unknown) => {
    enfileirados.push(j);
    return { job: { id: "j1" }, jaExistia: false };
  },
}));

const { toToolSet, getTool } = await import("../registry");
await import("./emails");
const { cartoesDoResultado } = await import("../../chat/cartoes-da-tela");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const gate = { enqueue: async () => ({ id: "a" }) } as unknown as Parameters<typeof toToolSet>[2];
function executar(nome: string, input: unknown = {}) {
  const set = toToolSet([getTool(nome)!], ctx, gate);
  return (set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: "c", messages: [] }) as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  pedidas.length = 0;
  enfileirados.length = 0;
});

describe("tools dos e-mails", () => {
  it("sem aba, lê as três e vira UM cartão com abas", async () => {
    const r = await executar("meus_emails");
    expect(pedidas).toEqual(["acao", "util", "ruido"]);
    expect(r.contagem).toEqual({ acao: 1, util: 1, ruido: 0 });
    expect((r.acao as { tarefa: string; de: string }[])[0]).toMatchObject({ tarefa: "Enviar o documento à Stripe", de: "Stripe" });
    const [c] = cartoesDoResultado("meus_emails", r);
    expect(c).toMatchObject({ id: "emails:triados", resumo: "1 pede ação · 1 útil" });
    expect(c!.grupos).toEqual([{ id: "acao", rotulo: "Ação", total: 1 }, { id: "util", rotulo: "Úteis", total: 1 }, { id: "ruido", rotulo: "Ruído", total: 0 }]);
    expect(c!.itens.find((i) => i.grupo === "acao")).toMatchObject({ texto: "Tarefa: Enviar o documento à Stripe", url: "https://mail.google.com/mail/#all/1" });
    expect(c!.itens.find((i) => i.grupo === "util")!.valor).toBe("+ R$ 150,00");
  });

  it("uma aba só lê aquela", async () => {
    await executar("meus_emails", { aba: "acao" });
    expect(pedidas).toEqual(["acao"]);
  });

  it("atualizar enfileira uma leitura (dedup) e as duas tools não passam pelo gate", async () => {
    await executar("atualizar_meus_emails");
    expect(enfileirados).toEqual([{ kind: "emails.triar", payload: {}, dedupKey: "emails-agora:u1" }]);
    expect(getTool("meus_emails")!.risk).toBe("leitura");
    expect(getTool("atualizar_meus_emails")!.risk).toBe("escrita");
  });
});
