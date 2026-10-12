import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools de bancos (CLAUDE.md §5.7): cada uma com o risco declarado, a
 * execução com a dependência mockada, o caminho feliz e um de erro. O que fica
 * travado: marcar transferência só usa pares que o CÓDIGO sugeriu (o modelo não
 * inventa id), e sincronizar passa pela fila.
 */

const enfileirados: { kind: string; dedupKey?: string }[] = [];
const comandos: Record<string, unknown>[] = [];
let erroDoExecutor: string | null = null;
let pares: unknown[] = [];

vi.mock("../../jobs/queue", () => ({
  enqueueJob: async (_u: string, j: { kind: string; dedupKey?: string }) => {
    enfileirados.push(j);
    return { job: { id: "j1" }, jaExistia: false };
  },
}));
vi.mock("../../pluggy/servico", () => ({
  visaoDoBanco: async () => ({
    conectado: true,
    widgetUrl: "x",
    itens: [{
      id: "i1", banco: "Itaú", status: "UPDATED", aviso: null, erro: null, atualizadoNoBancoEm: "2026-10-10T10:00:00.000Z", sincronizadoEm: null,
      contas: [
        { id: "c1", nome: "Itaú · Conta Corrente", numero: "1234", tipo: "BANK", ativa: true, contaId: "oc1", cartaoId: null, saldoBanco: 345410, saldoOrbita: 345410, limite: null, diaFechamento: null, diaVencimento: null },
        { id: "c2", nome: "Itaú · Cartão", numero: null, tipo: "CREDIT", ativa: true, contaId: null, cartaoId: null, saldoBanco: null, saldoOrbita: null, limite: 500000, diaFechamento: 7, diaVencimento: 15 },
      ],
    }],
  }),
}));
vi.mock("../../finance/transferencias", () => ({ paresSugeridosDoDono: async () => pares }));
vi.mock("../../finance/store", () => ({
  carregar: async () => ({ contas: [{ id: "oc1", nome: "Itaú" }, { id: "oc2", nome: "Nubank" }] }),
  hojeDoServidor: () => "2026-10-10",
}));
vi.mock("../../finance/config", () => ({ limiaresDaConfig: async () => ({ mesesSemeados: 2 }) }));
vi.mock("../../finance/comandos", () => ({
  executar: async (_u: string, cmd: Record<string, unknown>) => {
    const { RegraFinanceiraError } = await import("../../finance/operacoes");
    if (erroDoExecutor) throw new RegraFinanceiraError(erroDoExecutor);
    comandos.push(cmd);
    return { mensagem: "2 transferências marcadas.", grupos: ["g1", "g2"] };
  },
}));

const { toToolSet, getTool } = await import("../registry");
await import("./bancos");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const gate = { enqueue: async () => ({ id: "acao-1" }) } as unknown as Parameters<typeof toToolSet>[2];

function rodar(nome: string, input: unknown = {}) {
  const set = toToolSet([getTool(nome)!], ctx, gate);
  const tool = set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  return tool.execute(input, { toolCallId: "c1", messages: [] }) as Promise<Record<string, unknown>>;
}

const par = (id: string, eid: string) => ({
  saida: { id, tipo: "despesa", data: "2026-10-09", valor: 50000, descricao: null, contaId: "oc1" },
  entrada: { id: eid, tipo: "receita", data: "2026-10-09", valor: 50000, descricao: null, contaId: "oc2" },
  dias: 0,
});

beforeEach(() => {
  enfileirados.length = 0;
  comandos.length = 0;
  erroDoExecutor = null;
  pares = [par("s1", "e1"), par("s2", "e2")];
});

describe("tools de bancos", () => {
  it("estão registradas no domínio bancos, com nome em snake_case e o risco declarado", () => {
    const esperado: Record<string, string> = {
      situacao_dos_bancos: "leitura", sincronizar_bancos: "escrita", transferencias_sugeridas: "leitura", marcar_transferencias: "escrita", desmarcar_transferencias: "escrita",
    };
    for (const [nome, risco] of Object.entries(esperado)) {
      const t = getTool(nome)!;
      expect(t, nome).toBeTruthy();
      expect(t.domain).toBe("bancos");
      expect(t.risk).toBe(risco);
      expect(nome).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("situação mostra o saldo do banco contra o da Órbita e diz se bate; cartão sem vínculo não está sincronizando", async () => {
    const r = (await rodar("situacao_dos_bancos")) as { bancos: { contas: Record<string, unknown>[] }[] };
    const [conta, cartao] = r.bancos[0]!.contas;
    expect(conta).toMatchObject({ saldo_no_banco: "R$ 3.454,10", saldo_na_orbita: "R$ 3.454,10", bate: true, sincronizando: true });
    expect(cartao).toMatchObject({ tipo: "cartão de crédito", sincronizando: false, bate: null });
  });

  it("sincronizar passa pela fila, com dedup, em vez de rodar na conversa", async () => {
    const r = await rodar("sincronizar_bancos");
    expect(enfileirados).toEqual([{ kind: "pluggy.sincronizar", payload: {}, dedupKey: "pluggy-agora:u1" }]);
    expect(String(r.mensagem)).toMatch(/lendo seus bancos/);
  });

  it("sugestões trazem nome das contas e o saida_id para marcar", async () => {
    const r = (await rodar("transferencias_sugeridas")) as { total: number; pares: Record<string, unknown>[] };
    expect(r.total).toBe(2);
    expect(r.pares[0]).toMatchObject({ saida_id: "s1", valor: "R$ 500,00", saiu_de: "Itaú", entrou_em_conta: "Nubank" });
  });

  it("sem par, diz que não achou em vez de listar vazio", async () => {
    pares = [];
    expect(String((await rodar("transferencias_sugeridas")).mensagem)).toMatch(/Não achei/);
  });

  it("marcar todas manda ao executor SÓ os pares que o código sugeriu, e devolve os grupos para desfazer", async () => {
    const r = await rodar("marcar_transferencias", { todas: true });
    expect(comandos[0]).toEqual({ tipo: "juntar_transferencia", pares: [{ saidaId: "s1", entradaId: "e1" }, { saidaId: "s2", entradaId: "e2" }] });
    expect(r.grupos).toEqual(["g1", "g2"]);
  });

  it("marcar por saída escolhida ignora id que não está entre as sugestões (o modelo não inventa par)", async () => {
    const r = await rodar("marcar_transferencias", { saida_ids: ["11111111-1111-4111-8111-111111111111"] });
    expect(comandos).toHaveLength(0);
    expect(String(r.erro)).toMatch(/não estão mais entre as sugestões/);
  });

  it("sem dizer quais, pede em vez de marcar tudo por conta própria", async () => {
    const r = await rodar("marcar_transferencias", {});
    expect(comandos).toHaveLength(0);
    expect(String(r.erro)).toMatch(/Diga quais/);
  });

  it("erro do dono no executor volta como erro legível", async () => {
    erroDoExecutor = "Um dos lançamentos já é transferência.";
    expect((await rodar("marcar_transferencias", { todas: true })).erro).toBe("Um dos lançamentos já é transferência.");
  });

  it("desmarcar usa os grupos devolvidos e exige pelo menos um", async () => {
    const g = "22222222-2222-4222-8222-222222222222";
    await rodar("desmarcar_transferencias", { grupos: [g] });
    expect(comandos[0]).toEqual({ tipo: "desjuntar_transferencia", grupos: [g] });
    // a validação roda antes do execute no SDK: lista vazia nem chega ao executor
    expect(getTool("desmarcar_transferencias")!.inputSchema.safeParse({ grupos: [] }).success).toBe(false);
    expect(getTool("desmarcar_transferencias")!.inputSchema.safeParse({ grupos: ["nao-e-uuid"] }).success).toBe(false);
  });
});
