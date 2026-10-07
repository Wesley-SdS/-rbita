import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DadosFinanceiros } from "../../finance/dados";

/**
 * As tools de finanças (CLAUDE.md §5.7: tool sem teste de `execute` não está
 * pronta). Elas não têm regra de dinheiro própria: traduzem o que o dono FALOU
 * em um comando e chamam o executor. Então o que fica travado aqui é a
 * tradução:
 *
 *   - reais viram CENTAVOS exatos (19,90 × 100 em ponto flutuante dá
 *     1989,999…; um floor roubaria um centavo de todo lançamento);
 *   - "no Nubank", "no dinheiro" e "a conta de luz" chegam ao id certo, e o
 *     nome ambíguo PERGUNTA em vez de chutar;
 *   - lançar é escrita e não passa pelo gate; apagar é perigoso e passa.
 *
 * O executor e o store são falsos: a regra de cada comando tem teste próprio
 * (`finance/operacoes.test.ts`, `finance/motor.test.ts`).
 */

const comandos: Record<string, unknown>[] = [];
let erroDoExecutor: string | null = null;
let repetidoNoExecutor = false;

const conta = (id: string, nome: string) => ({ id, userId: "u1", nome, tipo: "corrente" as const, saldoInicial: 0, cor: "#000000", ordem: 0 });
const cartao = (id: string, nome: string) => ({ id, userId: "u1", nome, limite: 500000, fechamento: 5, vencimento: 12, contaPagamentoId: "c1", cor: "#000000", ordem: 0 });
const cat = (id: string, nome: string, tipo: "despesa" | "receita") => ({ id, userId: "u1", nome, tipo, cor: "#000000", orcamento: 0, ordem: 0 });
const compromisso = (id: string, descricao: string, vencimento: string) => ({
  id, userId: "u1", direcao: "pagar" as const, descricao, valor: 150000, vencimento, categoriaId: null, contaId: "c1",
  recorrencia: "mensal" as const, serieId: "s", diaMes: 8, status: "aberto" as const, quitadoEm: null, lancamentoId: null, criadoEm: new Date(),
});

let dados: DadosFinanceiros;
function dadosPadrao(): DadosFinanceiros {
  return {
    renda: 1_000_000, teto: 0, boasVindasVistas: true,
    contas: [conta("c1", "Conta corrente"), conta("din", "Dinheiro")],
    cartoes: [cartao("nu", "Nubank"), cartao("it", "Itaú")],
    categorias: [cat("mer", "Mercado", "despesa"), cat("del", "Delivery e restaurante", "despesa"), cat("out", "Outros gastos", "despesa"), cat("sal", "Salário", "receita"), cat("oe", "Outras entradas", "receita")],
    lancamentos: [], compromissos: [compromisso("k2", "Aluguel", "2026-10-08"), compromisso("k1", "Aluguel", "2026-09-08")],
    pagamentosFatura: [], dividas: [], metas: [],
    atalhos: [{ id: "a1", userId: "u1", rotulo: "Almoço", valor: 3500, categoriaId: "del", contaId: "c1", cartaoId: null, ordem: 0 }],
    regras: [],
  };
}

vi.mock("../../finance/store", () => ({
  carregar: async () => dados,
  hojeDoServidor: () => "2026-09-27",
}));
vi.mock("../../finance/config", () => ({
  limiaresDaConfig: async () => ({ diasPerto: 7, diasJanela: 30, diasFimDoMes: 5, mesesMedia: 3, mesesSemeados: 2, mesesPrevisao: 12, repeticoesAtalho: 3 }),
}));
vi.mock("../../finance/comandos", () => ({
  executar: async (_u: string, cmd: Record<string, unknown>) => {
    const { RegraFinanceiraError } = await import("../../finance/operacoes");
    if (erroDoExecutor) throw new RegraFinanceiraError(erroDoExecutor);
    if (repetidoNoExecutor && !cmd.repetir) {
      const { RepetidoError } = await import("../../finance/operacoes");
      throw new RepetidoError("Já tem um lançamento igual: Abastecimento, R$ 100,00 em 05/10. Quer lançar de novo?", [{ descricao: "Abastecimento", valor: 10000, data: "2026-10-05" }], 0);
    }
    comandos.push(cmd);
    return { mensagem: "ok", desfazerId: "d1" };
  },
}));
const arquivosAoDono: { nome: string; mime: string; tamanho: number }[] = [];
let whatsappConectado = true;
vi.mock("../../whatsapp/avisar", () => ({
  mandarArquivoAoDono: async (_u: string, a: { bytes: Uint8Array; mime: string; nome: string }) => {
    if (!whatsappConectado) return false;
    arquivosAoDono.push({ nome: a.nome, mime: a.mime, tamanho: a.bytes.length });
    return true;
  },
}));

vi.mock("../../finance/bill-due", () => ({
  billsDueFor: async (_u: string, dias: number) => [{ descricao: "Luz", valor: 250.5, tipo: "a_pagar", vencimento: "2026-09-30", vencida: false, dias }],
}));

const { toToolSet, getTool } = await import("../registry");
const mod = await import("./financas");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const propostas: string[] = [];
const gate = {
  enqueue: async (d: { name: string }) => {
    propostas.push(d.name);
    return { id: "acao-1" };
  },
} as unknown as Parameters<typeof toToolSet>[2];

function executar(nome: string, input: unknown = {}, canal?: "tela" | "whatsapp" | "voz") {
  const set = toToolSet([getTool(nome)!], canal ? { ...ctx, canal } : ctx, gate);
  const tool = set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  return tool.execute(input, { toolCallId: "c1", messages: [] }) as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  dados = dadosPadrao();
  comandos.length = 0;
  propostas.length = 0;
  erroDoExecutor = null;
  repetidoNoExecutor = false;
});

describe("tools de finanças", () => {
  it("estão todas registradas no domínio finanças, com nome em snake_case", () => {
    const nomes = [
      "resumo_financeiro", "contas_a_vencer", "registrar_gasto", "lancar_por_frase", "transferir_dinheiro", "usar_atalho",
      "desfazer_lancamento", "adicionar_conta", "pagar_conta", "pagar_fatura", "registrar_divida", "pagar_divida", "criar_meta",
      "salvar_item_meta", "definir_renda", "cadastrar_cartao", "cadastrar_carteira", "apagar_lancamento", "apagar_tudo_financas",
    ];
    for (const n of nomes) {
      expect(getTool(n)?.domain, n).toBe("financas");
      expect(n).toMatch(/^[a-z_]+$/);
    }
  });

  it("R$ 19,90 vira 1990 centavos, não 1989", async () => {
    await executar("registrar_gasto", { descricao: "café", valor: 19.9 });
    expect(comandos[0]).toMatchObject({ tipo: "lancar", natureza: "despesa", valor: 1990, descricao: "café", data: "2026-09-27", contaId: "c1" });
  });

  it("gasto sem categoria dita cai no palpite e, sem palpite, em Outros gastos", async () => {
    await executar("registrar_gasto", { descricao: "ifood", valor: 30 });
    await executar("registrar_gasto", { descricao: "coisa rara", valor: 10 });
    expect(comandos.map((c) => c.categoriaId)).toEqual(["del", "out"]);
  });

  it("\"no Nubank\" vira compra no cartão, com parcelas", async () => {
    await executar("registrar_gasto", { descricao: "geladeira", valor: 3000, onde: "nubank", parcelas: 10 });
    expect(comandos[0]).toMatchObject({ cartaoId: "nu", contaId: null, parcelas: 10, valor: 300000 });
  });

  it("\"no dinheiro\" acha a carteira; nome desconhecido lista o que existe e não lança", async () => {
    await executar("registrar_gasto", { valor: 5, onde: "em dinheiro" });
    expect(comandos[0]).toMatchObject({ contaId: "din" });
    const r = await executar("registrar_gasto", { valor: 5, onde: "bradesco" });
    expect(r.erro).toContain("Não achei");
    expect(comandos).toHaveLength(1);
  });

  it("estorno é entrada com categoria de SAÍDA", async () => {
    await executar("registrar_gasto", { valor: 50, tipo: "estorno", descricao: "ifood" });
    expect(comandos[0]).toMatchObject({ natureza: "receita", estorno: true, categoriaId: "del" });
  });

  it("erro do dono volta como `erro` para o modelo explicar, sem estourar", async () => {
    erroDoExecutor = "Informe um valor maior que zero.";
    const r = await executar("registrar_gasto", { valor: 1 });
    expect(r).toEqual({ erro: "Informe um valor maior que zero." });
  });

  it("lançar é escrita: não passa pelo gate", async () => {
    await executar("registrar_gasto", { valor: 1 });
    expect(propostas).toEqual([]);
  });

  it("frase com dois lançamentos vira um lancar_varios só", async () => {
    const r = await executar("lancar_por_frase", { frase: "gastei 45,90 no mercado hoje e depois paguei 30 de ifood" });
    expect(comandos[0]).toMatchObject({ tipo: "lancar_varios", origem: "chat" });
    expect((comandos[0]!.itens as unknown[]).length).toBe(2);
    expect(r.lancados).toHaveLength(2);
  });

  it("frase sem valor pede o valor", async () => {
    const r = await executar("lancar_por_frase", { frase: "fui ao mercado" });
    expect(r.erro).toContain("Diga quanto foi");
    expect(comandos).toHaveLength(0);
  });

  it("atalho pelo nome sem acento; inexistente devolve os que existem", async () => {
    await executar("usar_atalho", { nome: "almoco" });
    expect(comandos[0]).toEqual({ tipo: "lancar_atalho", id: "a1" });
    const r = await executar("usar_atalho", { nome: "jantar" });
    expect(r.atalhos).toEqual(["Almoço (R$ 35,00)"]);
  });

  it("pagar conta quita a MAIS ANTIGA quando a conta fixa tem vários meses em aberto", async () => {
    await executar("pagar_conta", { conta: "aluguel" });
    expect(comandos[0]).toMatchObject({ tipo: "quitar", id: "k1", valor: 150000, contaId: null });
  });

  it("pagar conta com valor diferente e conta de origem", async () => {
    await executar("pagar_conta", { conta: "aluguel", valor: 1450.5, onde: "dinheiro" });
    expect(comandos[0]).toMatchObject({ valor: 145050, contaId: "din" });
  });

  it("transferência resolve as duas contas", async () => {
    await executar("transferir_dinheiro", { valor: 200, de: "conta corrente", para: "dinheiro" });
    expect(comandos[0]).toMatchObject({ tipo: "transferir", origemId: "c1", destinoId: "din", valor: 20000 });
  });

  it("conta a pagar guarda tipo, vencimento e recorrência", async () => {
    await executar("adicionar_conta", { descricao: "luz", valor: 250.5, tipo: "a_pagar", vencimento: "2026-10-10", todo_mes: true });
    expect(comandos[0]).toMatchObject({ tipo: "salvar_compromisso", direcao: "pagar", valor: 25050, vencimento: "2026-10-10", recorrente: true });
  });

  it("renda e teto numa chamada só", async () => {
    await executar("definir_renda", { renda: 8000, teto: 5000 });
    expect(comandos).toEqual([{ tipo: "definir_renda", valor: 800000 }, { tipo: "definir_teto", valor: 500000 }]);
  });

  it("cartão com nome que já existe é atualizado, não duplicado", async () => {
    await executar("cadastrar_cartao", { nome: "nubank", fecha_dia: 1, vence_dia: 8, limite: 9000 });
    expect(comandos[0]).toMatchObject({ tipo: "salvar_cartao", id: "nu", fechamento: 1, vencimento: 8, limite: 900000 });
  });

  it("acertar o saldo de hoje ajusta o saldo INICIAL pela diferença", async () => {
    dados.lancamentos = [{
      id: "l1", userId: "u1", tipo: "despesa", data: "2026-09-10", valor: 10000, descricao: null, categoriaId: null, contaId: "c1", cartaoId: null,
      transferencia: false, grupoTransferencia: null, fixo: false, estorno: false, grupoParcela: null, parcelaN: null, parcelaDe: null,
      metaId: null, metaItemId: null, compromissoId: null, importado: false, criadoEm: new Date(),
    }];
    await executar("cadastrar_carteira", { nome: "Conta corrente", saldo_hoje: 900 });
    // hoje o saldo é -100; para chegar em 900 o inicial passa a 1.000
    expect(comandos[0]).toMatchObject({ tipo: "salvar_conta", id: "c1", saldoInicial: 100000 });
  });

  it("consulta devolve dinheiro como texto em reais, pronto para a voz", async () => {
    const r = await executar("resumo_financeiro", { o_que: "posso_gastar" });
    expect(r.rendaMensal ?? r.possoGastarHoje ?? r.aindaCabeAteOFimDoMes).toMatch(/^R\$ /);
    expect(r.tenhoNaConta).toBe("R$ 0,00");
  });

  it("contas a vencer repassa o horizonte", async () => {
    const r = await executar("contas_a_vencer", { dias: 3 });
    expect(r.contas).toHaveLength(1);
  });

  it("repetido vira PERGUNTA para o dono; confirmado, vai com repetir", async () => {
    repetidoNoExecutor = true;
    const r = await executar("registrar_gasto", { valor: 100, descricao: "Abastecimento" });
    expect(r).toMatchObject({ repetido: true, pergunte_ao_dono: expect.stringContaining("Quer lançar de novo?") });
    expect(comandos).toHaveLength(0);
    await executar("registrar_gasto", { valor: 100, descricao: "Abastecimento", repetir: true });
    expect(comandos[0]).toMatchObject({ tipo: "lancar", repetir: true });
  });

  it("corrigir um lançamento não apaga: edita mantendo o que não foi dito", async () => {
    dados.lancamentos = [{
      id: "l9", userId: "u1", tipo: "despesa", data: "2026-10-05", valor: 10000, descricao: "Abastecendo $ 29 cachorro quente", categoriaId: "out", contaId: "c1", cartaoId: null,
      transferencia: false, grupoTransferencia: null, fixo: false, estorno: false, grupoParcela: null, parcelaN: null, parcelaDe: null,
      metaId: null, metaItemId: null, compromissoId: null, importado: false, criadoEm: new Date(),
    }];
    const r = await executar("editar_lancamento", { lancamento: "abastecendo", nova_descricao: "Abastecimento" });
    expect(comandos[0]).toEqual({
      tipo: "editar_lancamento", id: "l9", natureza: "despesa", valor: 10000, data: "2026-10-05", descricao: "Abastecimento",
      categoriaId: "out", contaId: "c1", cartaoId: null, estorno: false,
    });
    expect(r.antes).toContain("R$ 100,00");
    expect(mod.editar_lancamento.risk).toBe("escrita");
    expect(propostas).toEqual([]);
  });

  it("extrato em PDF: na tela vem o link com os filtros que o dono disse", async () => {
    const r = await executar("extrato_em_pdf", { mes: "2026-10", so: "saidas", onde: "nubank", categoria: "mercado" }, "tela");
    expect(r.link).toBe("/api/financas/exportar?formato=pdf&mes=2026-10&natureza=despesa&categoria=mer&onde=cartao%3Anu");
    expect(String(r.mensagem)).toContain("[baixar o PDF](");
    expect(arquivosAoDono).toEqual([]);
  });

  it("extrato em PDF: no WhatsApp o arquivo vai na conversa; sem WhatsApp conectado, cai no link", async () => {
    arquivosAoDono.length = 0;
    const r = await executar("extrato_em_pdf", { mes: "2026-10" }, "whatsapp");
    expect(arquivosAoDono).toHaveLength(1);
    expect(arquivosAoDono[0]).toMatchObject({ nome: "extrato-2026-10.pdf", mime: "application/pdf" });
    expect(arquivosAoDono[0]!.tamanho).toBeGreaterThan(500);
    expect(String(r.mensagem)).toContain("Mandei o PDF");
    whatsappConectado = false;
    const sem = await executar("extrato_em_pdf", { mes: "2026-10" }, "whatsapp");
    whatsappConectado = true;
    expect(sem.link).toContain("formato=pdf");
    expect(mod.extrato_em_pdf.risk).toBe("leitura");
  });

  it("APAGAR não executa sozinha: vai para o gate humano", async () => {
    // apagar UM lançamento passa pela aprovação mas sai por "manda"; zerar tudo é perigoso
    expect(mod.apagar_lancamento.risk).toBe("efeito_externo");
    expect(mod.apagar_tudo_financas.risk).toBe("perigoso");
    await executar("apagar_lancamento", { descricao: "café" });
    await executar("apagar_tudo_financas", { confirmo: true });
    expect(propostas).toEqual(["apagar_lancamento", "apagar_tudo_financas"]);
    expect(comandos).toHaveLength(0);
  });
});
