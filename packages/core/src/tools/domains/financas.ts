import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { carregar, hojeDoServidor, type DadosFinanceiros } from "../../finance/store";
import { limiaresDaConfig } from "../../finance/config";
import { executar, type Comando, type Resultado } from "../../finance/comandos";
import { RegraFinanceiraError, RepetidoError } from "../../finance/operacoes";
import { acharPorNome, normalizar } from "../../finance/nomes";
import { palpitarCategoria } from "../../finance/palpite";
import { proporDitado, extratoPdfDosDados } from "../../finance/entradas";
import { mandarArquivoAoDono } from "../../whatsapp/avisar";
import { brl, dataLonga, mesLongo, centavosDe } from "../../finance/formato";
import { mesDe, somarDias, type Ymd } from "../../finance/calendario";
import { billsDueFor } from "../../finance/bill-due";
import * as visoes from "../../finance/visoes";
import type { Farol } from "../../finance/mes";
import type { Quitacao } from "../../finance/divida";

/**
 * Domínio: finanças pessoais (PRD "Freio de Mão").
 *
 * Tudo que a tela de Finanças faz, a Órbita faz por chat, por voz realtime e
 * pelo "Ei Órbita": as três portas usam este registro. Cada tool traduz o que
 * o dono FALOU ("no Nubank", "a conta de luz") para o comando da tela e chama
 * o MESMO executor (`finance/comandos.ts`). Não existe regra de dinheiro aqui.
 *
 * Risco: lançar, pagar e cadastrar são `escrita` (dado interno do dono, sem
 * efeito fora de casa) e podem ser desfeitos; apagar é `perigoso` e passa
 * pela fila de aprovação, como `remover_tarefa`.
 *
 * Valores entram em REAIS (é o que o modelo entende e o dono fala) e saem como
 * texto "R$ 45,90", pronto para ser lido em voz alta.
 */

const REAIS = z.number().positive().max(10_000_000_000).describe("valor em reais, ex.: 45.9");
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("data YYYY-MM-DD; sem data = hoje");

type Ctx = { dados: DadosFinanceiros; hoje: Ymd };

async function contexto(userId: string): Promise<Ctx> {
  const hoje = hojeDoServidor();
  const lim = await limiaresDaConfig();
  return { dados: await carregar(userId, hoje, lim.mesesSemeados), hoje };
}

/** Roda o comando e devolve a frase do resultado; erro do dono vira `erro` (o modelo lê e explica). */
async function rodar(userId: string, cmd: Comando): Promise<Resultado | { erro: string; repetido?: true; pergunte_ao_dono?: string; se_ele_confirmar?: string }> {
  try {
    return await executar(userId, cmd, hojeDoServidor());
  } catch (e) {
    // repetido não é erro, é PERGUNTA (como o banco num Pix repetido): o
    // modelo pergunta ao dono e só chama de novo com `repetir` se ele confirmar
    if (e instanceof RepetidoError) {
      return {
        erro: e.message,
        repetido: true,
        pergunte_ao_dono: e.message,
        se_ele_confirmar: e.novos
          ? "chame de novo com repetir: true (lança tudo) ou so_os_novos: true (pula os repetidos)"
          : "chame de novo com repetir: true",
      };
    }
    if (e instanceof RegraFinanceiraError) return { erro: e.message };
    throw e;
  }
}

type Onde = { contaId: string | null; cartaoId: string | null } | { erro: string };

/** "no Nubank", "no dinheiro", "na conta corrente": acha cartão, depois conta. Sem nome, a primeira conta. */
function resolverOnde(d: DadosFinanceiros, dito: string | undefined, podeCartao: boolean): Onde {
  if (!dito?.trim()) return { contaId: d.contas[0]?.id ?? null, cartaoId: null };
  if (podeCartao) {
    const c = acharPorNome(d.cartoes, dito, (x) => x.nome);
    if (c.tipo === "um") return { contaId: null, cartaoId: c.item.id };
    if (c.tipo === "varios") return { erro: `Qual cartão? ${c.opcoes.map((x) => x.nome).join(", ")}.` };
  }
  const q = normalizar(dito);
  if (["dinheiro", "especie", "cash", "na mao"].some((p) => q.includes(p))) {
    const din = d.contas.find((x) => normalizar(x.nome).includes("dinheiro"));
    if (din) return { contaId: din.id, cartaoId: null };
  }
  const c = acharPorNome(d.contas, dito, (x) => x.nome);
  if (c.tipo === "um") return { contaId: c.item.id, cartaoId: null };
  if (c.tipo === "varios") return { erro: `Qual conta? ${c.opcoes.map((x) => x.nome).join(", ")}.` };
  if (podeCartao && /cart[aã]o|cr[eé]dito/i.test(dito) && d.cartoes.length === 1) return { contaId: null, cartaoId: d.cartoes[0]!.id };
  const nomes = [...d.contas.map((x) => x.nome), ...(podeCartao ? d.cartoes.map((x) => `cartão ${x.nome}`) : [])];
  return { erro: `Não achei "${dito}". Tenho: ${nomes.join(", ")}.` };
}

/** Categoria pelo nome dito; senão o palpite pela descrição (regras do dono e palavras-chave); senão "Outros". */
function resolverCategoria(d: DadosFinanceiros, natureza: "despesa" | "receita", dita: string | undefined, descricao: string | undefined): string | null {
  const doTipo = d.categorias.filter((c) => c.tipo === natureza);
  const achada = acharPorNome(doTipo, dita, (c) => c.nome);
  if (achada.tipo === "um") return achada.item.id;
  const cats = d.categorias.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo }));
  const palpite = palpitarCategoria(`${dita ?? ""} ${descricao ?? ""}`, d.regras, cats, natureza);
  if (palpite) return palpite;
  const padrao = natureza === "despesa" ? "outros gastos" : "outras entradas";
  return doTipo.find((c) => normalizar(c.nome) === padrao)?.id ?? null;
}

const textoQuitacao = (q: Quitacao) =>
  q.tipo === "quitada" ? "quitada"
    : q.tipo === "impossivel" ? (q.motivo === "sem_parcela" ? "sem parcela definida, sem previsão" : "a parcela não cobre os juros: do jeito que está, nunca acaba")
      : `quita em ${q.meses} ${q.meses === 1 ? "mês" : "meses"}, pagando ${brl(q.totalPago)} no total (${brl(q.juros)} de juros)`;

function textoFarol(f: Farol): Record<string, unknown> {
  switch (f.modo) {
    case "sem_saidas":
      return { situacao: "O painel ainda não sabe o que sai todo mês: cadastre contas fixas e cartões antes de confiar no número.", rendaMensal: brl(f.base) };
    case "posso_gastar":
      return f.fimDoMes
        ? { aindaCabeAteOFimDoMes: brl(f.valor), porDia: brl(Math.max(0, f.porDia)), diasQueFaltam: f.diasRestantes, passouDoMes: f.sobra < 0 ? brl(-f.sobra) : null }
        : { possoGastarHoje: brl(f.valor), sobraNoMes: brl(f.sobra), diasQueFaltam: f.diasRestantes, gastoLivreAteAgora: brl(f.livre), disponivelParaGastoLivre: brl(f.disponivel), totalGastoNoMes: brl(f.gastoTotal), passouDoMes: f.sobra < 0 ? brl(-f.sobra) : null };
    case "previsao_30":
      return { semRendaCadastrada: true, sobraEm30Dias: brl(f.sobra), tenhoHoje: brl(f.saldo), entra: brl(f.aReceber), sai: brl(f.aPagar) };
    case "gasto_do_mes":
      return { gastoNoMes: brl(f.gasto), teto: f.teto ? brl(f.teto) : null, ritmoPorDia: f.ritmoDia ? brl(f.ritmoDia) : null, fechaOMesEm: f.projecao ? brl(f.projecao) : null };
  }
}

// ── leitura ────────────────────────────────────────────────────────────────

const Consulta = z.object({
  o_que: z
    .enum(["posso_gastar", "painel", "extrato", "contas", "cartoes", "dividas", "metas", "previsao", "historico", "saldos"])
    .default("posso_gastar")
    .describe("posso_gastar = quanto posso gastar hoje; painel = visão geral do mês; extrato = lançamentos; contas = a pagar/receber; cartoes = faturas; saldos = quanto tem em cada conta"),
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM; sem mês = o atual"),
  busca: z.string().max(80).optional().describe("filtro do extrato por descrição ou categoria"),
});
export const resumo_financeiro: ToolDef<typeof Consulta> = {
  name: "resumo_financeiro",
  domain: "financas",
  description:
    "Consulta as finanças do dono: quanto pode gastar hoje, gasto do mês por categoria, extrato, contas a pagar e a receber, faturas de cartão, dívidas e quando acabam, metas, previsão dos próximos meses, histórico e saldo das contas. Use para qualquer pergunta sobre dinheiro.",
  risk: "leitura",
  keywords: ["gastar", "gastei", "gasto", "saldo", "sobra", "resumo", "finanças", "dinheiro", "fatura", "cartão", "dívida", "meta", "previsão", "extrato", "orçamento", "quanto"],
  inputSchema: Consulta,
  run: async ({ o_que, mes, busca }, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const lim = await limiaresDaConfig();
    const ym = mes ?? mesDe(hoje);
    switch (o_que) {
      case "posso_gastar":
      case "painel": {
        const p = visoes.painel(dados, ym, hoje, lim);
        const base = { mes: mesLongo(ym), ...textoFarol(p.farol), tenhoNaConta: brl(p.indicadores.tenho), aPagarEm30Dias: brl(p.indicadores.aPagar), sobraEm30Dias: brl(p.indicadores.sobra), jaGasteiNoMes: brl(p.indicadores.gastoMes) };
        if (o_que === "posso_gastar") return base;
        return {
          ...base,
          avisos: { vencidas: p.avisos.vencidas.n ? `${p.avisos.vencidas.n} (${brl(p.avisos.vencidas.total)})` : null, venceEmBreve: p.avisos.perto.n ? `${p.avisos.perto.n} (${brl(p.avisos.perto.total)})` : null },
          comoOMesSeDivide: p.divisao && { contasFixas: brl(p.divisao.contasFixas), parcelas: brl(p.divisao.parcelas), metas: brl(p.divisao.metas), gastoLivre: brl(p.divisao.livre), sobra: p.divisao.sobra === null ? null : brl(p.divisao.sobra) },
          paraOndeFoi: p.paraOndeFoi.categorias.map((c) => ({ categoria: c.nome, total: brl(c.total), pct: Math.round(c.pct), orcamento: c.orcamento ? brl(c.orcamento) : null })),
          faturasAbertas: p.faturas.map((f) => ({ cartao: f.nome, valor: brl(f.valor), fecha: dataLonga(f.fechamento), vence: dataLonga(f.vencimento) })),
        };
      }
      case "extrato": {
        const e = visoes.extrato(dados, ym, hoje, lim, { busca });
        return {
          mes: mesLongo(ym), lancamentos: e.resumo.n, saidas: brl(e.resumo.saidas), entradas: brl(e.resumo.entradas),
          itens: e.dias.flatMap((dia) => dia.itens).slice(0, 40).map((l) => ({ data: dataLonga(l.data), descricao: l.titulo, valor: `${l.natureza === "despesa" ? "-" : "+"} ${brl(l.valor)}`, categoria: l.categoria?.nome ?? null, onde: l.onde, transferencia: l.transferencia || undefined })),
          previstos: e.previstos.map((c) => ({ descricao: c.descricao, valor: brl(c.valor), vence: dataLonga(c.vencimento), tipo: c.direcao })),
        };
      }
      case "contas": {
        const c = visoes.contas(dados, ym, hoje, lim);
        return {
          aPagarEm30Dias: brl(c.topo.aPagar), aReceberEm30Dias: brl(c.topo.aReceber), emAtraso: brl(c.topo.emAtraso),
          emAberto: c.emAberto.slice(0, 30).map((x) => ({ descricao: x.descricao, valor: brl(x.valor), vencimento: dataLonga(x.vencimento), tipo: x.direcao === "pagar" ? "a pagar" : "a receber", situacao: x.situacao, fixa: x.fixa })),
        };
      }
      case "cartoes":
        return {
          cartoes: visoes.cartoes(dados, hoje).map((c) => ({
            cartao: c.nome, faturaQueFecha: dataLonga(c.fatura.fechamento), vence: dataLonga(c.fatura.vencimento),
            valorDaFatura: brl(c.fatura.pago > 0 ? c.fatura.restante : c.fatura.total), jaPago: c.fatura.pago ? brl(c.fatura.pago) : null,
            limiteUsado: c.limite ? brl(c.usado) : null, limiteLivre: c.limite ? brl(c.livre) : null, faturasEmAberto: c.abertas.length,
          })),
        };
      case "dividas":
        return {
          dividas: visoes.contas(dados, ym, hoje, lim).dividas.map((x) => ({ divida: x.nome, saldoDevedor: brl(x.saldo), jurosAoMes: `${x.jurosMes}%`, parcela: x.parcelaMensal ? brl(x.parcelaMensal) : null, previsao: textoQuitacao(x.quitacao) })),
        };
      case "metas":
        return {
          metas: visoes.metas(dados, hoje).map((m) => ({ meta: m.nome, total: brl(m.total), teto: m.orcamento ? brl(m.orcamento) : null, jaPago: brl(m.jaPago), parcelasAVencer: brl(m.aVencer), semContratar: brl(m.semContratar), passouDoTeto: m.orcamento && m.total > m.orcamento ? brl(m.total - m.orcamento) : null })),
        };
      case "previsao": {
        const p = visoes.previsao(dados, hoje, lim);
        return {
          comprometidoNosProximosMeses: brl(p.totalComprometido),
          mesMaisApertado: p.maisApertado && { mes: mesLongo(p.maisApertado.mes), livre: brl(p.maisApertado.livre) },
          meses: p.meses.map((m) => ({ mes: mesLongo(m.mes), entra: brl(m.entra), comprometido: brl(m.comprometido), livre: brl(m.livre), saldoProjetado: m.saldoProjetado === null ? null : brl(m.saldoProjetado) })),
          semRendaCadastrada: !p.temRenda || undefined,
        };
      }
      case "historico": {
        const h = visoes.historico(dados, hoje);
        return {
          mediaPorMes: brl(h.media),
          meses: h.meses.filter((m) => m.temMovimento).map((m) => ({ mes: mesLongo(m.mes), gasto: brl(m.gasto), entrada: brl(m.entrada) })),
          categoriasQueMaisMudaram: h.comparacao.map((c) => ({ categoria: c.categoria?.nome ?? "Sem categoria", media: brl(c.media), agora: brl(c.agora), variacao: `${c.pct >= 0 ? "+" : ""}${Math.round(c.pct)}%` })),
          // "onde eu mais gasto?": por LUGAR (iFood, mercado), nos 12 meses
          ondeMaisGasta: h.periodos[h.periodos.length - 1]!.lugares.map((l) => ({ lugar: l.lugar, total: brl(l.total), vezes: l.vezes, ticketMedio: brl(l.ticketMedio), ultimoMesContraOsTresAnteriores: l.pctUltimoMes === null ? null : `${l.pctUltimoMes >= 0 ? "+" : ""}${l.pctUltimoMes}%` })),
        };
      }
      case "saldos": {
        const c = visoes.cadastros(dados, ym, hoje, 0);
        return { contas: c.contas.map((x) => ({ conta: x.nome, saldo: brl(x.saldo) })), total: brl(c.contas.reduce((s, x) => s + x.saldo, 0)) };
      }
    }
  },
};

const Vencer = z.object({ dias: z.number().int().min(0).max(90).default(7) });
export const contas_a_vencer: ToolDef<typeof Vencer> = {
  name: "contas_a_vencer",
  domain: "financas",
  description: "Lista as contas a pagar e a receber em aberto que vencem nos próximos N dias (padrão 7), incluindo as já vencidas. Use para alertar sobre vencimentos.",
  risk: "leitura",
  keywords: ["vencer", "vencimento", "contas", "próximos dias", "atrasada", "vencida", "boleto"],
  inputSchema: Vencer,
  run: async ({ dias }, { userId }) => ({ contas: await billsDueFor(userId, dias) }),
};

// ── lançar ─────────────────────────────────────────────────────────────────

const Gasto = z.object({
  valor: REAIS,
  descricao: z.string().max(120).optional().describe("o que foi, ex.: almoço, mercado, uber"),
  tipo: z.enum(["saida", "entrada", "estorno"]).default("saida").describe("saida = gasto; entrada = dinheiro que entrou; estorno = reembolso que abate um gasto"),
  categoria: z.string().max(60).optional().describe("nome da categoria, se o dono disse"),
  onde: z.string().max(60).optional().describe("nome da conta ou do cartão (ex.: Nubank, dinheiro); sem nome = conta principal"),
  parcelas: z.number().int().min(1).max(48).optional().describe("só compra no cartão"),
  data: DATA,
  guardar_como_atalho: z.boolean().optional(),
  repetir: z.boolean().optional().describe("true SÓ depois de o dono confirmar que quer lançar de novo um igual a um que já existe"),
});
export const registrar_gasto: ToolDef<typeof Gasto> = {
  name: "registrar_gasto",
  domain: "financas",
  description:
    "Lança um gasto, uma entrada de dinheiro ou um estorno já acontecido, numa conta ou num cartão (compra parcelada no cartão com `parcelas`). Para conta com vencimento futuro use adicionar_conta; para mover dinheiro entre contas próprias use transferir_dinheiro.",
  risk: "escrita",
  keywords: ["gasto", "gastei", "despesa", "paguei", "comprei", "recebi", "entrou", "estorno", "reembolso", "parcelado", "reais", "lançar", "lança"],
  inputSchema: Gasto,
  run: async (i, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const natureza = i.tipo === "entrada" ? "receita" : i.tipo === "estorno" ? "receita" : "despesa";
    const onde = resolverOnde(dados, i.onde, natureza === "despesa");
    if ("erro" in onde) return onde;
    // estorno abate um GASTO: a categoria é de saída (§7.1)
    const categoriaId = resolverCategoria(dados, i.tipo === "estorno" ? "despesa" : natureza, i.categoria, i.descricao);
    return rodar(userId, {
      tipo: "lancar", natureza, valor: centavosDe(i.valor), data: i.data ?? hoje, descricao: i.descricao ?? null, categoriaId,
      contaId: onde.contaId, cartaoId: onde.cartaoId, estorno: i.tipo === "estorno", parcelas: i.parcelas, guardarAtalho: i.guardar_como_atalho, repetir: i.repetir,
    });
  },
};

const Frase = z.object({
  frase: z.string().min(3).max(1000).describe("o que o dono disse, do jeito que disse"),
  repetir: z.boolean().optional().describe("true SÓ depois de o dono confirmar que quer lançar de novo o que já estava lançado"),
  so_os_novos: z.boolean().optional().describe("true quando o dono pediu para lançar só os que ainda não estavam lançados"),
});
export const lancar_por_frase: ToolDef<typeof Frase> = {
  name: "lancar_por_frase",
  domain: "financas",
  description:
    "Lança de uma vez um ou mais gastos, entradas, estornos ou saques ditos em linguagem natural, ex.: \"gastei 45,90 no mercado e depois paguei 1200 de aluguel\". Use quando o dono citar vários lançamentos na mesma frase.",
  risk: "escrita",
  keywords: ["gastei", "paguei", "comprei", "recebi", "saquei", "estornaram", "depois", "lançar", "ditado"],
  inputSchema: Frase,
  run: async ({ frase, repetir, so_os_novos }, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    let propostas: ReturnType<typeof proporDitado>;
    try {
      propostas = proporDitado(dados, frase, hoje);
    } catch (e) {
      if (e instanceof RegraFinanceiraError) return { erro: e.message };
      throw e;
    }
    const itens = propostas.map((p) =>
      p.tipo === "transferencia"
        ? { tipo: "transferir" as const, valor: p.valor, data: p.data, descricao: p.descricao, origemId: p.origemId ?? "", destinoId: p.destinoId ?? "" }
        : { tipo: "lancar" as const, natureza: p.tipo, valor: p.valor, data: p.data, descricao: p.descricao, categoriaId: p.categoriaId, contaId: p.contaId, cartaoId: p.cartaoId, estorno: p.estorno, parcelas: p.cartaoId ? p.parcelas : undefined },
    ).filter((x) => x.tipo === "lancar" || (x.origemId && x.destinoId));
    if (!itens.length) return { erro: "Para um saque ou transferência preciso de duas contas cadastradas." };
    const r = await rodar(userId, { tipo: "lancar_varios", itens, origem: "chat", repetir, pularRepetidos: so_os_novos });
    if ("erro" in r) return r;
    const cat = new Map(dados.categorias.map((c) => [c.id, c.nome]));
    return {
      ...r,
      lancados: propostas.map((p) => (p.tipo === "transferencia"
        ? { transferencia: brl(p.valor) }
        : { descricao: p.descricao, valor: brl(p.valor), tipo: p.estorno ? "estorno" : p.tipo === "despesa" ? "saída" : "entrada", categoria: cat.get(p.categoriaId ?? "") ?? null, parcelas: p.parcelas > 1 && p.cartaoId ? p.parcelas : undefined, data: p.data !== hoje ? dataLonga(p.data) : undefined })),
    };
  },
};

const Transf = z.object({
  valor: REAIS,
  de: z.string().max(60).describe("conta de onde sai"),
  para: z.string().max(60).describe("conta onde entra"),
  descricao: z.string().max(120).optional(),
  data: DATA,
});
export const transferir_dinheiro: ToolDef<typeof Transf> = {
  name: "transferir_dinheiro",
  domain: "financas",
  description: "Registra dinheiro mudando de lugar entre contas do próprio dono (saque, Pix para si mesmo, reserva). Não conta como gasto.",
  risk: "escrita",
  keywords: ["transferi", "transferência", "saquei", "saque", "pix", "reserva", "mover"],
  inputSchema: Transf,
  run: async (i, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const de = resolverOnde(dados, i.de, false);
    const para = resolverOnde(dados, i.para, false);
    if ("erro" in de) return de;
    if ("erro" in para) return para;
    return rodar(userId, { tipo: "transferir", valor: centavosDe(i.valor), data: i.data ?? hoje, descricao: i.descricao ?? null, origemId: de.contaId!, destinoId: para.contaId! });
  },
};

const Atalho = z.object({ nome: z.string().min(1).max(60).describe("nome do atalho, ex.: almoço, café") });
export const usar_atalho: ToolDef<typeof Atalho> = {
  name: "usar_atalho",
  domain: "financas",
  description: "Lança um gasto pré-configurado pelo nome do atalho (\"lança o almoço\", \"marca o café\"). Se não existir, devolve os atalhos que existem.",
  risk: "escrita",
  keywords: ["atalho", "almoço", "café", "de sempre", "lança"],
  inputSchema: Atalho,
  run: async ({ nome }, { userId }) => {
    const { dados } = await contexto(userId);
    const a = acharPorNome(dados.atalhos, nome, (x) => x.rotulo);
    if (a.tipo === "nenhum") return { erro: `Não tenho atalho "${nome}".`, atalhos: dados.atalhos.map((x) => `${x.rotulo} (${brl(x.valor)})`) };
    if (a.tipo === "varios") return { erro: "Qual deles?", atalhos: a.opcoes.map((x) => `${x.rotulo} (${brl(x.valor)})`) };
    return rodar(userId, { tipo: "lancar_atalho", id: a.item.id });
  },
};

export const desfazer_lancamento: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "desfazer_lancamento",
  domain: "financas",
  description: "Desfaz o último lançamento que a Órbita fez nas finanças (\"desfaz\", \"não era isso\", \"lancei errado\").",
  risk: "escrita",
  keywords: ["desfaz", "desfazer", "errado", "cancela", "volta"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => rodar(userId, { tipo: "desfazer" }),
};

// ── contas a pagar e a receber ─────────────────────────────────────────────

const Conta = z.object({
  descricao: z.string().min(1).max(120),
  valor: REAIS,
  tipo: z.enum(["a_pagar", "a_receber"]).default("a_pagar"),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD; sem data = hoje"),
  todo_mes: z.boolean().default(false).describe("conta fixa que repete todo mês (aluguel, internet, salário)"),
  categoria: z.string().max(60).optional(),
});
export const adicionar_conta: ToolDef<typeof Conta> = {
  name: "adicionar_conta",
  domain: "financas",
  description: "Cadastra uma conta a pagar ou a receber com vencimento (boleto, aluguel, salário), fixa todo mês ou avulsa. Para gasto que já aconteceu use registrar_gasto.",
  risk: "escrita",
  keywords: ["conta", "boleto", "vencimento", "vence", "pagar", "receber", "fixa", "todo mês", "aluguel", "salário"],
  inputSchema: Conta,
  run: async (i, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const direcao = i.tipo === "a_pagar" ? "pagar" : "receber";
    const categoriaId = resolverCategoria(dados, direcao === "pagar" ? "despesa" : "receita", i.categoria, i.descricao);
    return rodar(userId, { tipo: "salvar_compromisso", direcao, descricao: i.descricao, valor: centavosDe(i.valor), vencimento: i.vencimento ?? hoje, categoriaId, recorrente: i.todo_mes });
  },
};

const Quitar = z.object({
  conta: z.string().min(1).max(120).describe("descrição da conta, ex.: aluguel, luz"),
  valor: z.number().positive().max(10_000_000_000).optional().describe("valor pago, se diferente do previsto"),
  onde: z.string().max(60).optional().describe("de onde saiu / onde entrou"),
  data: DATA,
});
export const pagar_conta: ToolDef<typeof Quitar> = {
  name: "pagar_conta",
  domain: "financas",
  description: "Marca uma conta a pagar como paga (ou a receber como recebida), gerando o lançamento. Acha pela descrição; com várias em aberto do mesmo nome, quita a de vencimento mais antigo.",
  risk: "escrita",
  keywords: ["paguei", "pago", "quitei", "quitar", "recebi", "conta", "boleto"],
  inputSchema: Quitar,
  run: async (i, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const abertas = dados.compromissos.filter((c) => c.status === "aberto");
    const a = acharPorNome(abertas, i.conta, (c) => c.descricao);
    if (a.tipo === "nenhum") return { erro: `Não achei conta em aberto "${i.conta}".`, emAberto: abertas.slice(0, 15).map((c) => `${c.descricao} (${brl(c.valor)}, vence ${dataLonga(c.vencimento)})`) };
    // mesma conta fixa em vários meses é o caso comum: quita a mais antiga
    const candidatas = a.tipo === "um" ? [a.item] : a.opcoes;
    const mesmaDescricao = candidatas.every((c) => normalizar(c.descricao) === normalizar(candidatas[0]!.descricao));
    if (!mesmaDescricao) return { erro: "Qual delas?", opcoes: candidatas.map((c) => `${c.descricao} (${brl(c.valor)}, vence ${dataLonga(c.vencimento)})`) };
    const c = [...candidatas].sort((x, y) => (x.vencimento < y.vencimento ? -1 : 1))[0]!;
    const onde = resolverOnde(dados, i.onde, c.direcao === "pagar");
    if ("erro" in onde) return onde;
    const r = await rodar(userId, { tipo: "quitar", id: c.id, valor: i.valor ? centavosDe(i.valor) : c.valor, data: i.data ?? hoje, contaId: i.onde ? onde.contaId : null, cartaoId: onde.cartaoId });
    return "erro" in r ? r : { ...r, conta: c.descricao, valor: brl(i.valor ? centavosDe(i.valor) : c.valor), vencimento: dataLonga(c.vencimento) };
  },
};

// ── cartão e dívida ────────────────────────────────────────────────────────

const Fatura = z.object({
  cartao: z.string().min(1).max(60),
  valor: z.number().positive().max(10_000_000_000).optional().describe("sem valor = paga a fatura inteira"),
  resto: z.enum(["rotativo", "depois"]).optional().describe("se pagar parte: o resto vira rotativo (dívida com juros) ou fica em aberto para pagar depois"),
  de: z.string().max(60).optional().describe("conta de onde saiu"),
  data: DATA,
});
export const pagar_fatura: ToolDef<typeof Fatura> = {
  name: "pagar_fatura",
  domain: "financas",
  description: "Registra o pagamento da fatura mais antiga em aberto de um cartão, inteira ou parcial. Pagamento parcial sem dizer o que fazer com o resto: pergunte ao dono se vira rotativo ou fica em aberto.",
  risk: "escrita",
  keywords: ["fatura", "cartão", "paguei a fatura", "rotativo", "crédito"],
  inputSchema: Fatura,
  run: async (i, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const c = acharPorNome(dados.cartoes, i.cartao, (x) => x.nome);
    if (c.tipo !== "um") return { erro: c.tipo === "varios" ? "Qual cartão?" : `Não achei o cartão "${i.cartao}".`, cartoes: dados.cartoes.map((x) => x.nome) };
    const visao = visoes.cartoes(dados, hoje).find((x) => x.id === c.item.id)!;
    const fatura = visao.abertas[0];
    if (!fatura) return { erro: "Nenhuma fatura em aberto neste cartão." };
    const valor = i.valor ? centavosDe(i.valor) : fatura.restante;
    if (valor < fatura.restante && !i.resto) {
      return { pergunta: `A fatura que fecha em ${dataLonga(fatura.fechamento)} tem ${brl(fatura.restante)} em aberto. Faltariam ${brl(fatura.restante - valor)}: vira rotativo (com juros) ou fica em aberto para pagar depois?` };
    }
    let contaId: string | null = null;
    if (i.de) {
      const o = resolverOnde(dados, i.de, false);
      if ("erro" in o) return o;
      contaId = o.contaId;
    }
    return rodar(userId, { tipo: "pagar_fatura", cartaoId: c.item.id, fechamento: fatura.fechamento, valor, data: i.data ?? hoje, contaId, resto: i.resto ?? "rotativo" });
  },
};

const Divida = z.object({
  nome: z.string().min(1).max(80),
  saldo_devedor: z.number().min(0).max(10_000_000_000).describe("quanto deve hoje, em reais"),
  juros_ao_mes: z.number().min(0).max(100).default(0).describe("% ao mês, ex.: 2.5"),
  parcela_mensal: z.number().min(0).max(10_000_000_000).default(0),
  tipo: z.enum(["emprestimo", "cartao-rotativo", "cheque-especial", "crediario", "outro"]).default("emprestimo"),
});
export const registrar_divida: ToolDef<typeof Divida> = {
  name: "registrar_divida",
  domain: "financas",
  description: "Cadastra ou atualiza uma dívida que cobra juros (empréstimo, cheque especial, crediário) para acompanhar em quantos meses acaba. Conta a pagar comum não é dívida.",
  risk: "escrita",
  keywords: ["dívida", "empréstimo", "juros", "cheque especial", "crediário", "financiamento", "devo"],
  inputSchema: Divida,
  run: async (i, { userId }) => {
    const { dados } = await contexto(userId);
    const existente = acharPorNome(dados.dividas, i.nome, (d) => d.nome);
    return rodar(userId, {
      tipo: "salvar_divida", id: existente.tipo === "um" && normalizar(existente.item.nome) === normalizar(i.nome) ? existente.item.id : null,
      nome: i.nome, natureza: i.tipo, saldo: centavosDe(i.saldo_devedor), jurosMes: i.juros_ao_mes, parcelaMensal: centavosDe(i.parcela_mensal),
    });
  },
};

const PagDivida = z.object({
  divida: z.string().min(1).max(80),
  valor: z.number().positive().max(10_000_000_000).optional().describe("sem valor = a parcela mensal"),
  juros: z.number().min(0).max(10_000_000_000).optional().describe("quanto do valor foi juros, se o dono souber"),
  de: z.string().max(60).optional(),
  data: DATA,
});
export const pagar_divida: ToolDef<typeof PagDivida> = {
  name: "pagar_divida",
  domain: "financas",
  description: "Registra um pagamento de dívida: separa juros do abatimento e lança a saída da conta.",
  risk: "escrita",
  keywords: ["dívida", "empréstimo", "parcela", "paguei", "abater"],
  inputSchema: PagDivida,
  run: async (i, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const d = acharPorNome(dados.dividas, i.divida, (x) => x.nome);
    if (d.tipo !== "um") return { erro: d.tipo === "varios" ? "Qual dívida?" : `Não achei a dívida "${i.divida}".`, dividas: dados.dividas.map((x) => x.nome) };
    const valor = i.valor ? centavosDe(i.valor) : d.item.parcelaMensal;
    if (!valor) return { erro: "Quanto foi pago? Essa dívida não tem parcela definida." };
    let contaId: string | null = null;
    if (i.de) {
      const o = resolverOnde(dados, i.de, false);
      if ("erro" in o) return o;
      contaId = o.contaId;
    }
    return rodar(userId, { tipo: "pagar_divida", id: d.item.id, valor, juros: i.juros === undefined ? null : centavosDe(i.juros), data: i.data ?? hoje, contaId });
  },
};

// ── metas ──────────────────────────────────────────────────────────────────

const Meta = z.object({
  nome: z.string().min(1).max(120),
  teto: z.number().min(0).max(10_000_000_000).default(0).describe("orçamento máximo em reais; 0 = sem teto"),
  modelo: z.enum(["imovel", "reforma", "imovel-reforma"]).optional().describe("começar com a lista pronta de itens de compra de imóvel e/ou reforma"),
  observacao: z.string().max(500).optional(),
});
export const criar_meta: ToolDef<typeof Meta> = {
  name: "criar_meta",
  domain: "financas",
  description: "Cria uma meta (projeto com teto de orçamento e lista de itens): compra do apartamento, reforma, viagem. Pode começar de um modelo pronto.",
  risk: "escrita",
  keywords: ["meta", "projeto", "reforma", "apartamento", "imóvel", "viagem", "orçamento", "teto"],
  inputSchema: Meta,
  run: async (i, { userId }) => rodar(userId, { tipo: "salvar_meta", nome: i.nome, orcamento: centavosDe(i.teto), descricao: i.observacao ?? null, modelo: i.modelo ?? null }),
};

const Item = z.object({
  meta: z.string().min(1).max(120),
  item: z.string().min(1).max(120).describe("nome do item; se já existir na meta, é atualizado"),
  valor: z.number().min(0).max(10_000_000_000).optional(),
  situacao: z.enum(["planejado", "orcado", "contratado", "pago"]).optional(),
  etapa: z.string().max(80).optional(),
  forma: z.enum(["avista", "cartao", "boleto", "carne"]).optional(),
  parcelas: z.number().int().min(1).max(48).optional(),
  primeira_parcela: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cartao_ou_conta: z.string().max(60).optional(),
  observacao: z.string().max(500).optional(),
});
export const salvar_item_meta: ToolDef<typeof Item> = {
  name: "salvar_item_meta",
  domain: "financas",
  description:
    "Adiciona ou atualiza um item de uma meta (ex.: \"o porcelanato da reforma ficou 8 mil em 10x no Nubank, contratado\"). Contratado ou pago gera as parcelas no extrato e na fatura.",
  risk: "escrita",
  keywords: ["item", "meta", "reforma", "orçamento", "contratei", "orçado", "fechei"],
  inputSchema: Item,
  run: async (i, { userId }) => {
    const { dados } = await contexto(userId);
    const m = acharPorNome(dados.metas, i.meta, (x) => x.nome);
    if (m.tipo !== "um") return { erro: m.tipo === "varios" ? "Qual meta?" : `Não achei a meta "${i.meta}".`, metas: dados.metas.map((x) => x.nome) };
    const achado = acharPorNome(m.item.itens, i.item, (x) => x.nome);
    const antes = achado.tipo === "um" ? achado.item : null;
    let contaId = antes?.contaId ?? null;
    let cartaoId = antes?.cartaoId ?? null;
    const forma = i.forma ?? antes?.forma ?? "avista";
    if (i.cartao_ou_conta) {
      const o = resolverOnde(dados, i.cartao_ou_conta, forma === "cartao");
      if ("erro" in o) return o;
      contaId = o.contaId;
      cartaoId = o.cartaoId;
    }
    const r = await rodar(userId, {
      tipo: "salvar_item", id: antes?.id ?? null, metaId: m.item.id, nome: antes?.nome ?? i.item,
      valor: i.valor !== undefined ? centavosDe(i.valor) : (antes?.valor ?? 0), grupo: i.etapa ?? antes?.grupo ?? null,
      status: i.situacao ?? antes?.status ?? "planejado", forma: cartaoId ? "cartao" : forma, parcelas: i.parcelas ?? antes?.parcelas ?? 1,
      primeiroVenc: i.primeira_parcela ?? antes?.primeiroVenc ?? null, contaId, cartaoId, obs: i.observacao ?? antes?.obs ?? null,
    });
    return r;
  },
};

// ── cadastros ──────────────────────────────────────────────────────────────

const Renda = z.object({
  renda: z.number().min(0).max(10_000_000_000).optional().describe("quanto entra por mês, em reais"),
  teto: z.number().min(0).max(10_000_000_000).optional().describe("limite de gastos do mês, em reais"),
});
export const definir_renda: ToolDef<typeof Renda> = {
  name: "definir_renda",
  domain: "financas",
  description: "Define a renda mensal (é dela que sai o \"quanto posso gastar hoje\") e/ou um teto de gastos do mês.",
  risk: "escrita",
  keywords: ["renda", "salário", "ganho", "teto", "limite", "por mês"],
  inputSchema: Renda,
  run: async (i, { userId }) => {
    if (i.renda === undefined && i.teto === undefined) return { erro: "Diga a renda ou o teto." };
    const msgs: string[] = [];
    for (const [tipo, v] of [["definir_renda", i.renda], ["definir_teto", i.teto]] as const) {
      if (v === undefined) continue;
      const r = await rodar(userId, { tipo, valor: centavosDe(v) });
      if ("erro" in r) return r;
      msgs.push(r.mensagem);
    }
    return { mensagem: msgs.join(" ") };
  },
};

const Cartao = z.object({
  nome: z.string().min(1).max(60),
  limite: z.number().min(0).max(10_000_000_000).default(0),
  fecha_dia: z.number().int().min(1).max(31),
  vence_dia: z.number().int().min(1).max(31),
  paga_pela_conta: z.string().max(60).optional(),
});
export const cadastrar_cartao: ToolDef<typeof Cartao> = {
  name: "cadastrar_cartao",
  domain: "financas",
  description: "Cadastra (ou atualiza, pelo nome) um cartão de crédito com dia de fechamento, dia de vencimento e limite, para as compras caírem na fatura certa.",
  risk: "escrita",
  keywords: ["cartão", "crédito", "fechamento", "fecha", "vence", "limite", "nubank", "itaú", "inter"],
  inputSchema: Cartao,
  run: async (i, { userId }) => {
    const { dados } = await contexto(userId);
    const existe = dados.cartoes.find((c) => normalizar(c.nome) === normalizar(i.nome));
    let conta: string | null = null;
    if (i.paga_pela_conta) {
      const o = resolverOnde(dados, i.paga_pela_conta, false);
      if ("erro" in o) return o;
      conta = o.contaId;
    }
    return rodar(userId, { tipo: "salvar_cartao", id: existe?.id ?? null, nome: i.nome, limite: centavosDe(i.limite), fechamento: i.fecha_dia, vencimento: i.vence_dia, contaPagamentoId: conta ?? existe?.contaPagamentoId ?? null });
  },
};

const Carteira = z.object({ nome: z.string().min(1).max(60), saldo_hoje: z.number().min(-10_000_000_000).max(10_000_000_000).default(0) });
export const cadastrar_carteira: ToolDef<typeof Carteira> = {
  name: "cadastrar_carteira",
  domain: "financas",
  description: "Cadastra (ou acerta o saldo, pelo nome) uma conta bancária ou carteira onde o dinheiro fica, com o saldo de hoje.",
  risk: "escrita",
  keywords: ["conta bancária", "carteira", "banco", "saldo", "caixa", "poupança"],
  inputSchema: Carteira,
  run: async (i, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const existe = dados.contas.find((c) => normalizar(c.nome) === normalizar(i.nome));
    const alvo = centavosDe(i.saldo_hoje);
    if (!existe) return rodar(userId, { tipo: "salvar_conta", nome: i.nome, saldoInicial: alvo });
    // "o saldo de hoje é X": o saldo INICIAL é o que falta para os lançamentos chegarem em X
    const atual = visoes.cadastros(dados, mesDe(hoje), hoje, 0).contas.find((c) => c.id === existe.id)!;
    return rodar(userId, { tipo: "salvar_conta", id: existe.id, nome: existe.nome, saldoInicial: existe.saldoInicial + (alvo - atual.saldo) });
  },
};

// ── extrato em PDF ─────────────────────────────────────────────────────────

const ExtratoPdf = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM; sem mês = o atual"),
  so: z.enum(["saidas", "entradas"]).optional().describe("só saídas ou só entradas"),
  categoria: z.string().max(60).optional(),
  onde: z.string().max(60).optional().describe("só uma conta ou um cartão"),
  busca: z.string().max(80).optional().describe("só lançamentos com esse texto"),
});
/**
 * O extrato em PDF entregue ONDE o dono está: no WhatsApp, o arquivo chega na
 * conversa "Eu"; na tela e na voz, vai o link para baixar. É leitura: o
 * arquivo só vai para o próprio dono, nunca para terceiro.
 */
export const extrato_em_pdf: ToolDef<typeof ExtratoPdf> = {
  name: "extrato_em_pdf",
  domain: "financas",
  description: "Gera o extrato do mês em PDF (para guardar, imprimir ou mandar ao contador), com filtros opcionais. No WhatsApp manda o arquivo na conversa; no chat e na voz devolve o link para baixar.",
  risk: "leitura",
  keywords: ["extrato", "pdf", "exportar", "relatório", "baixar", "imprimir", "contador", "arquivo"],
  inputSchema: ExtratoPdf,
  run: async (i, ctx) => {
    const { dados, hoje } = await contexto(ctx.userId);
    const ym = i.mes ?? mesDe(hoje);
    let onde: string | null = null;
    if (i.onde) {
      const o = resolverOnde(dados, i.onde, true);
      if ("erro" in o) return o;
      onde = o.cartaoId ? `cartao:${o.cartaoId}` : `conta:${o.contaId}`;
    }
    const natureza = i.so === "saidas" ? ("despesa" as const) : i.so === "entradas" ? ("receita" as const) : null;
    const cat = i.categoria ? acharPorNome(dados.categorias, i.categoria, (c) => c.nome) : null;
    const categoriaId = cat?.tipo === "um" ? cat.item.id : null;
    const filtros = { natureza, categoriaId, onde, busca: i.busca ?? null };
    const nome = `extrato-${ym}.pdf`;
    if (ctx.canal === "whatsapp") {
      const pdf = await extratoPdfDosDados(dados, ym, hoje, await limiaresDaConfig(), filtros);
      const foi = await mandarArquivoAoDono(ctx.userId, { bytes: pdf, mime: "application/pdf", nome }, `Extrato de ${mesLongo(ym)}`);
      if (foi) return { mensagem: `Mandei o PDF do extrato de ${mesLongo(ym)} aqui na conversa.`, arquivo: nome };
    }
    const q = new URLSearchParams({ formato: "pdf", mes: ym });
    if (natureza) q.set("natureza", natureza);
    if (categoriaId) q.set("categoria", categoriaId);
    if (onde) q.set("onde", onde);
    if (i.busca) q.set("q", i.busca);
    const link = `/api/financas/exportar?${q.toString()}`;
    return { mensagem: `O extrato de ${mesLongo(ym)} em PDF está pronto: [baixar o PDF](${link})`, link, arquivo: nome };
  },
};

// ── corrigir ───────────────────────────────────────────────────────────────

const Editar = z.object({
  lancamento: z.string().min(1).max(120).describe("descrição do lançamento a corrigir, como está hoje"),
  data: DATA.describe("data do lançamento a corrigir, se o dono disse"),
  nova_descricao: z.string().max(120).optional(),
  valor: z.number().positive().max(10_000_000_000).optional().describe("novo valor em reais"),
  categoria: z.string().max(60).optional(),
  onde: z.string().max(60).optional().describe("nova conta ou cartão"),
  nova_data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
/**
 * Corrigir sem apagar. Sem ela, "atualize esse de 100, foi abastecimento"
 * virava apagar (com aprovação) e lançar de novo, e o dono ficou mandando
 * "manda" para uma exclusão que nunca saía (05/10/2026). Corrigir o próprio
 * lançamento é escrita interna, como lançar: não passa pelo gate.
 */
export const editar_lancamento: ToolDef<typeof Editar> = {
  name: "editar_lancamento",
  domain: "financas",
  description: "Corrige um lançamento já registrado: descrição, valor, categoria, data ou conta/cartão (\"esse de 100 foi abastecimento\", \"o mercado foi 45, não 54\"). Use em vez de apagar e lançar de novo.",
  risk: "escrita",
  keywords: ["corrigir", "corrige", "atualiza", "atualize", "mudar", "muda", "editar", "errado", "foi", "lançamento"],
  inputSchema: Editar,
  run: async (i, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const desde = somarDias(hoje, -120);
    const recentes = dados.lancamentos.filter((l) => (i.data ? l.data === i.data : l.data >= desde) && !l.transferencia);
    const a = acharPorNome(recentes, i.lancamento, (l) => l.descricao ?? "");
    if (a.tipo === "nenhum") return { erro: `Não achei lançamento "${i.lancamento}".` };
    const alvo = a.tipo === "um" ? a.item : a.opcoes[0]!; // a lista já vem do mais recente
    let contaId = alvo.contaId;
    let cartaoId = alvo.cartaoId;
    if (i.onde) {
      const o = resolverOnde(dados, i.onde, alvo.tipo === "despesa");
      if ("erro" in o) return o;
      contaId = o.contaId;
      cartaoId = o.cartaoId;
    }
    const descricao = i.nova_descricao ?? alvo.descricao;
    const categoriaId = i.categoria ? resolverCategoria(dados, alvo.estorno ? "despesa" : alvo.tipo, i.categoria, descricao ?? undefined) : alvo.categoriaId;
    const r = await rodar(userId, {
      tipo: "editar_lancamento", id: alvo.id, natureza: alvo.tipo, valor: i.valor ? centavosDe(i.valor) : alvo.valor,
      data: i.nova_data ?? alvo.data, descricao, categoriaId, contaId, cartaoId, estorno: alvo.estorno,
    });
    return "erro" in r ? r : { ...r, antes: `${alvo.descricao ?? "sem descrição"} ${brl(alvo.valor)} de ${dataLonga(alvo.data)}` };
  },
};

// ── apagar (com aprovação) ─────────────────────────────────────────────────

const Apagar = z.object({
  descricao: z.string().min(1).max(120).describe("descrição do lançamento a apagar"),
  data: DATA,
});
export const apagar_lancamento: ToolDef<typeof Apagar> = {
  name: "apagar_lancamento",
  domain: "financas",
  description: "Apaga um lançamento já registrado (o mais recente com essa descrição). Vai para aprovação do dono antes de apagar. Para CORRIGIR use editar_lancamento; para o que a Órbita acabou de lançar, desfazer_lancamento.",
  // Continua com aprovação, mas não `perigoso`: perigoso nunca sai por frase
  // (§5.1, a fechadura não abre por "manda"), e apagar um lançamento não é
  // isso. Como `perigoso`, o dono mandou "manda" e "aprovado" várias vezes no
  // WhatsApp e nada saía (05/10/2026). Zerar TUDO continua perigoso.
  risk: "efeito_externo",
  keywords: ["apagar", "apaga", "remover", "excluir", "lançamento"],
  inputSchema: Apagar,
  summarize: (i) => `Apagar o lançamento "${i.descricao}"${i.data ? ` de ${dataLonga(i.data)}` : ""}`,
  run: async (i, { userId }) => {
    const { dados, hoje } = await contexto(userId);
    const desde = somarDias(hoje, -120);
    const recentes = dados.lancamentos.filter((l) => (i.data ? l.data === i.data : l.data >= desde) && !l.metaId && !l.transferencia);
    const a = acharPorNome(recentes, i.descricao, (l) => l.descricao ?? "");
    if (a.tipo === "nenhum") return { erro: `Não achei lançamento "${i.descricao}".` };
    const alvo = a.tipo === "um" ? a.item : a.opcoes[0]!; // lista já vem do mais recente
    const r = await rodar(userId, { tipo: "apagar_lancamento", id: alvo.id });
    return "erro" in r ? r : { ...r, apagado: `${alvo.descricao} ${brl(alvo.valor)} de ${dataLonga(alvo.data)}` };
  },
};

// `confirmo` é booleano e conferido no `run`, não `z.literal(true)`: o literal
// vira `enum: [true]`, que o Gemini Live recusa, e a sessão de voz INTEIRA
// deixava de abrir (05/10/2026). A trava de verdade é o risco `perigoso`.
const ApagarTudo = z.object({ confirmo: z.boolean().describe("true só quando o dono confirmou que quer zerar tudo") });
export const apagar_tudo_financas: ToolDef<typeof ApagarTudo> = {
  name: "apagar_tudo_financas",
  domain: "financas",
  description: "Apaga TODAS as finanças (lançamentos, contas, cartões, metas) e volta ao início. Só quando o dono pedir explicitamente para zerar tudo. Vai para aprovação.",
  risk: "perigoso",
  keywords: ["apagar tudo", "zerar", "recomeçar", "limpar finanças"],
  inputSchema: ApagarTudo,
  summarize: () => "Apagar TODOS os dados financeiros e voltar ao início (não tem volta)",
  run: async ({ confirmo }, { userId }) => (confirmo ? rodar(userId, { tipo: "apagar_tudo" }) : { erro: "Só apago tudo com a sua confirmação." }),
};

registerTools([
  resumo_financeiro, contas_a_vencer, registrar_gasto, lancar_por_frase, transferir_dinheiro, usar_atalho, desfazer_lancamento,
  adicionar_conta, pagar_conta, pagar_fatura, registrar_divida, pagar_divida, criar_meta, salvar_item_meta,
  definir_renda, cadastrar_cartao, cadastrar_carteira, editar_lancamento, extrato_em_pdf, apagar_lancamento, apagar_tudo_financas,
]);
