import { diasEntre, diasNoMes, mesDe, partes, somarMeses, type Ym, type Ymd } from "./calendario";
import { faturaAberta, faturasDoCartao, limiteDoCartao, type Fatura } from "./cartao";
import { projetarQuitacao, saldoDevedor, type Quitacao } from "./divida";
import {
  classificarGasto, farol, gastoDiario, gastoDoMes, gastoPorCategoria, janela, previstoDoMes, saldoDaConta, saldoTotal,
  situacaoDaConta, baseDoMes, entradaDoMes, type Farol, type Situacao,
} from "./mes";
import { preverMeses, type Previsao } from "./previsao";
import { resumirMeta, type ResumoDeMeta } from "./metas";
import { sugerirAtalhos, type SugestaoDeAtalho } from "./sugestoes";
import { iniciais } from "./formato";
import { paraMotor, type DadosFinanceiros } from "./dados";
import type { Centavos, Limiares } from "./tipos";
import type { FinCompromisso, FinLancamento } from "@orbita/db/finance-schema";

/**
 * O que cada tela mostra (PRD §6), já calculado. A tela só desenha: regra de
 * negócio no backend (CLAUDE.md §6). E as tools de consulta devolvem ESTES
 * objetos, então "quanto posso gastar hoje?" por voz é o mesmo número do
 * farol.
 */

export interface Pastilha {
  nome: string;
  cor: string;
  iniciais: string;
}

export interface LinhaDeLancamento {
  id: string;
  natureza: "despesa" | "receita";
  data: Ymd;
  valor: Centavos;
  descricao: string | null;
  /** descrição, ou o nome da categoria quando não há descrição */
  titulo: string;
  categoriaId: string | null;
  categoria: Pastilha | null;
  contaId: string | null;
  cartaoId: string | null;
  /** nome da conta ou "Cartão X" */
  onde: string;
  transferencia: boolean;
  grupoTransferencia: string | null;
  estorno: boolean;
  fixo: boolean;
  grupoParcela: string | null;
  parcelaN: number | null;
  parcelaDe: number | null;
  metaId: string | null;
  compromissoId: string | null;
}

export interface LinhaDeConta {
  id: string;
  direcao: "pagar" | "receber";
  descricao: string;
  valor: Centavos;
  vencimento: Ymd;
  situacao: Situacao;
  fixa: boolean;
  quitadoEm: Ymd | null;
  categoriaId: string | null;
  categoria: Pastilha | null;
  contaId: string | null;
}

type Contexto = ReturnType<typeof contexto>;

function contexto(d: DadosFinanceiros) {
  const cats = new Map(d.categorias.map((c) => [c.id, c]));
  const contas = new Map(d.contas.map((c) => [c.id, c]));
  const cartoes = new Map(d.cartoes.map((c) => [c.id, c]));
  const pastilha = (id: string | null | undefined): Pastilha | null => {
    const c = id ? cats.get(id) : undefined;
    return c ? { nome: c.nome, cor: c.cor, iniciais: iniciais(c.nome) } : null;
  };
  return { cats, contas, cartoes, pastilha, motor: paraMotor(d) };
}

function linha(ctx: Contexto, l: FinLancamento): LinhaDeLancamento {
  const cat = ctx.pastilha(l.categoriaId);
  return {
    id: l.id,
    natureza: l.tipo,
    data: l.data,
    valor: l.valor,
    descricao: l.descricao,
    titulo: l.descricao || cat?.nome || (l.tipo === "despesa" ? "Saída" : "Entrada"),
    categoriaId: l.categoriaId,
    categoria: cat,
    contaId: l.contaId,
    cartaoId: l.cartaoId,
    onde: l.cartaoId ? `Cartão ${ctx.cartoes.get(l.cartaoId)?.nome ?? ""}`.trim() : (ctx.contas.get(l.contaId ?? "")?.nome ?? ""),
    transferencia: l.transferencia,
    grupoTransferencia: l.grupoTransferencia,
    estorno: l.estorno,
    fixo: l.fixo,
    grupoParcela: l.grupoParcela,
    parcelaN: l.parcelaN,
    parcelaDe: l.parcelaDe,
    metaId: l.metaId,
    compromissoId: l.compromissoId,
  };
}

function linhaDeConta(ctx: Contexto, c: FinCompromisso, hoje: Ymd, lim: Limiares): LinhaDeConta {
  return {
    id: c.id,
    direcao: c.direcao,
    descricao: c.descricao,
    valor: c.valor,
    vencimento: c.vencimento,
    situacao: situacaoDaConta(c, hoje, lim.diasPerto),
    fixa: c.recorrencia === "mensal",
    quitadoEm: c.quitadoEm,
    categoriaId: c.categoriaId,
    categoria: ctx.pastilha(c.categoriaId),
    contaId: c.contaId,
  };
}

const porDataDesc = (a: FinLancamento, b: FinLancamento) =>
  a.data === b.data ? b.criadoEm.getTime() - a.criadoEm.getTime() : a.data < b.data ? 1 : -1;

// ── painel (§6.1) ──────────────────────────────────────────────────────────

export interface Painel {
  mes: Ym;
  /** o "perto de vencer" da config, para o aviso dizer "nos próximos N dias" */
  diasPerto: number;
  mesAtual: boolean;
  avisos: { vencidas: { n: number; total: Centavos }; perto: { n: number; total: Centavos } };
  farol: Farol;
  atalhos: { id: string; rotulo: string; valor: Centavos; cor: string | null }[];
  sugestoes: SugestaoDeAtalho[];
  indicadores: { tenho: Centavos; aPagar: Centavos; sobra: Centavos; gastoMes: Centavos };
  divisao: {
    contasFixas: Centavos; parcelas: Centavos; metas: Centavos; livre: Centavos; sobra: Centavos | null;
    base: Centavos | null; total: Centavos; comprometido: Centavos; proximos: { mes: Ym; valor: Centavos }[];
  } | null;
  ritmo: { acumulado: Centavos[]; anterior: Centavos[]; teto: Centavos | null; comparacao: { antes: Centavos; diferenca: Centavos } | null };
  paraOndeFoi: { total: Centavos; categorias: { categoriaId: string | null; nome: string; cor: string; total: Centavos; pct: number; orcamento: Centavos }[] };
  faturas: { cartaoId: string; nome: string; cor: string; fechamento: Ymd; vencimento: Ymd; valor: Centavos }[];
  dividas: { id: string; nome: string; saldo: Centavos; quitacao: Quitacao }[];
  ultimos: LinhaDeLancamento[];
  boasVindas: boolean;
}

export function painel(d: DadosFinanceiros, ym: Ym, hoje: Ymd, lim: Limiares): Painel {
  const ctx = contexto(d);
  const m = ctx.motor;
  const mesAtual = mesDe(hoje) === ym;
  const abertasPagar = d.compromissos.filter((c) => c.direcao === "pagar" && c.status === "aberto");
  const vencidas = abertasPagar.filter((c) => c.vencimento < hoje);
  const perto = abertasPagar.filter((c) => c.vencimento >= hoje && diasEntre(hoje, c.vencimento) <= lim.diasPerto);
  const soma = (cs: FinCompromisso[]) => cs.reduce((s, c) => s + c.valor, 0);

  const j = janela(m.compromissos, hoje, lim.diasJanela);
  const tenho = saldoTotal(m.contas, m.lancamentos, hoje);
  const cls = classificarGasto(m.lancamentos, ym);
  const prev = previstoDoMes(m.lancamentos, m.compromissos, ym);
  const base = baseDoMes(d.renda, d.teto);
  const comprometido = prev.contasFixas + prev.parcelas + prev.metas;
  const total = comprometido + cls.livre;
  const proximos = Array.from({ length: 5 }, (_, i) => {
    const mes = somarMeses(ym, i + 1);
    const p = previstoDoMes(m.lancamentos, m.compromissos, mes);
    return { mes, valor: p.contasFixas + p.parcelas + p.metas };
  });

  const diario = gastoDiario(m.lancamentos, ym);
  const ate = mesAtual ? partes(hoje).d : diasNoMes(ym);
  const anterior = gastoDiario(m.lancamentos, somarMeses(ym, -1)).acumulado;
  const antes = anterior[Math.min(ate, anterior.length) - 1] ?? 0;
  const agora = diario.acumulado[ate - 1] ?? 0;

  const gasto = gastoDoMes(m.lancamentos, ym);
  const porCat = gastoPorCategoria(m.lancamentos, ym).slice(0, 8).map((g) => {
    const c = g.categoriaId ? ctx.cats.get(g.categoriaId) : undefined;
    return { categoriaId: g.categoriaId, nome: c?.nome ?? "Sem categoria", cor: c?.cor ?? "#79857F", total: g.total, pct: gasto > 0 ? (g.total / gasto) * 100 : 0, orcamento: c?.orcamento ?? 0 };
  });

  return {
    mes: ym,
    diasPerto: lim.diasPerto,
    mesAtual,
    avisos: { vencidas: { n: vencidas.length, total: soma(vencidas) }, perto: { n: perto.length, total: soma(perto) } },
    farol: farol(m, ym, hoje, lim),
    atalhos: d.atalhos.map((a) => ({ id: a.id, rotulo: a.rotulo, valor: a.valor, cor: ctx.cats.get(a.categoriaId ?? "")?.cor ?? null })).slice(0, 8),
    sugestoes: d.atalhos.length ? [] : sugerirAtalhos(m.lancamentos, m.categorias, lim.repeticoesAtalho),
    indicadores: { tenho, aPagar: j.aPagar, sobra: tenho + j.aReceber - j.aPagar, gastoMes: gasto },
    divisao: total > 0 || base !== null
      ? { contasFixas: prev.contasFixas, parcelas: prev.parcelas, metas: prev.metas, livre: cls.livre, sobra: base !== null ? Math.max(0, base - total) : null, base, total, comprometido, proximos }
      : null,
    ritmo: {
      acumulado: diario.acumulado.slice(0, ate),
      anterior,
      teto: d.teto > 0 ? d.teto : null,
      comparacao: antes > 0 ? { antes, diferenca: agora - antes } : null,
    },
    paraOndeFoi: { total: gasto, categorias: porCat },
    faturas: d.cartoes.map((c) => {
      const f = faturaAberta(c, m.lancamentos, m.pagamentosFatura, hoje);
      return { cartaoId: c.id, nome: c.nome, cor: c.cor, fechamento: f.fechamento, vencimento: f.vencimento, valor: f.pago > 0 ? f.restante : f.total };
    }),
    dividas: d.dividas.slice(0, 4).map((x) => {
      const saldo = saldoDevedor(x);
      return { id: x.id, nome: x.nome, saldo, quitacao: projetarQuitacao(saldo, x.jurosMes, x.parcelaMensal) };
    }),
    // parcela de julho do ano que vem não é "último lançamento": o que ainda não aconteceu fica fora
    ultimos: d.lancamentos.filter((l) => l.data <= hoje).sort(porDataDesc).slice(0, 7).map((l) => linha(ctx, l)),
    boasVindas: !d.boasVindasVistas && d.lancamentos.length === 0 && d.renda === 0,
  };
}

// ── extrato (§6.2) ─────────────────────────────────────────────────────────

export interface FiltrosDoExtrato {
  busca?: string | null;
  natureza?: "despesa" | "receita" | null;
  categoriaId?: string | null;
  /** "conta:ID" ou "cartao:ID" */
  onde?: string | null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function extrato(d: DadosFinanceiros, ym: Ym, hoje: Ymd, lim: Limiares, f: FiltrosDoExtrato) {
  const ctx = contexto(d);
  const q = f.busca ? semAcento(f.busca.trim()) : "";
  const casaBusca = (texto: string, catId: string | null) => !q || semAcento(texto).includes(q) || semAcento(ctx.cats.get(catId ?? "")?.nome ?? "").includes(q);
  const [ondeTipo, ondeId] = (f.onde ?? "").split(":");

  const lancados = d.lancamentos
    .filter((l) => mesDe(l.data) === ym)
    .filter((l) => !f.natureza || l.tipo === f.natureza)
    .filter((l) => !f.categoriaId || l.categoriaId === f.categoriaId)
    .filter((l) => !ondeId || (ondeTipo === "cartao" ? l.cartaoId === ondeId : l.contaId === ondeId && !l.cartaoId))
    .filter((l) => casaBusca(l.descricao ?? "", l.categoriaId))
    .sort(porDataDesc);

  // o filtro de conta/cartão não vale para o previsto (§6.2.2)
  const previstos = d.compromissos
    .filter((c) => c.status === "aberto" && mesDe(c.vencimento) === ym)
    .filter((c) => !f.natureza || (f.natureza === "despesa" ? c.direcao === "pagar" : c.direcao === "receber"))
    .filter((c) => !f.categoriaId || c.categoriaId === f.categoriaId)
    .filter((c) => casaBusca(c.descricao, c.categoriaId))
    .map((c) => linhaDeConta(ctx, c, hoje, lim));

  const dias = new Map<Ymd, FinLancamento[]>();
  for (const l of lancados) dias.set(l.data, [...(dias.get(l.data) ?? []), l]);

  const somaTipo = (t: "despesa" | "receita") => lancados.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0);
  return {
    resumo: {
      n: lancados.length,
      saidas: somaTipo("despesa"),
      entradas: somaTipo("receita"),
      previstos: previstos.length,
      aPagar: previstos.filter((c) => c.direcao === "pagar").reduce((s, c) => s + c.valor, 0),
      aReceber: previstos.filter((c) => c.direcao === "receber").reduce((s, c) => s + c.valor, 0),
    },
    previstos,
    dias: [...dias.entries()].map(([data, ls]) => ({
      data,
      totalSaidas: ls.filter((l) => l.tipo === "despesa" && !l.transferencia).reduce((s, l) => s + l.valor, 0),
      itens: ls.map((l) => linha(ctx, l)),
    })),
  };
}

// ── contas e dívidas (§6.3) ────────────────────────────────────────────────

export function contas(d: DadosFinanceiros, ym: Ym, hoje: Ymd, lim: Limiares) {
  const ctx = contexto(d);
  const j = janela(ctx.motor.compromissos, hoje, lim.diasJanela);
  const conv = (c: FinCompromisso) => linhaDeConta(ctx, c, hoje, lim);
  const porVenc = (a: FinCompromisso, b: FinCompromisso) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0);
  return {
    topo: j,
    emAberto: d.compromissos.filter((c) => c.status === "aberto").sort(porVenc).map(conv),
    doMes: d.compromissos.filter((c) => mesDe(c.vencimento) === ym).sort(porVenc).map(conv),
    quitadas: d.compromissos.filter((c) => c.status === "quitado" && mesDe(c.vencimento) === ym).sort((a, b) => -porVenc(a, b)).map(conv),
    dividas: d.dividas.map((x) => {
      const saldo = saldoDevedor(x);
      return {
        id: x.id,
        nome: x.nome,
        natureza: x.tipo,
        saldo,
        saldoInicial: x.saldoInicial,
        abatido: x.saldoInicial - saldo,
        jurosMes: x.jurosMes,
        parcelaMensal: x.parcelaMensal,
        contaId: x.contaId,
        cartaoId: x.cartaoId,
        jurosDoMes: Math.round(saldo * (x.jurosMes / 100)),
        quitacao: projetarQuitacao(saldo, x.jurosMes, x.parcelaMensal),
        pagamentos: x.pagamentos.slice(0, 8).map((p) => ({ id: p.id, data: p.data, valor: p.valor, juros: p.juros, abatimento: p.abatimento })),
      };
    }),
  };
}

// ── cartões (§6.4) ─────────────────────────────────────────────────────────

export function cartoes(d: DadosFinanceiros, hoje: Ymd) {
  const ctx = contexto(d);
  const m = ctx.motor;
  return d.cartoes.map((c) => {
    const f: Fatura = faturaAberta(c, m.lancamentos, m.pagamentosFatura, hoje);
    const lim = limiteDoCartao(c, m.lancamentos, m.pagamentosFatura, m.dividas);
    const abertas = faturasDoCartao(c, m.lancamentos, m.pagamentosFatura).filter((x) => !x.paga);
    const compras = d.lancamentos.filter((l) => f.compras.some((x) => x.id === l.id)).sort(porDataDesc);
    return {
      id: c.id,
      nome: c.nome,
      cor: c.cor,
      limite: c.limite,
      fechamentoDia: c.fechamento,
      vencimentoDia: c.vencimento,
      contaPagamentoId: c.contaPagamentoId,
      fatura: { fechamento: f.fechamento, vencimento: f.vencimento, total: f.total, pago: f.pago, restante: f.restante, paga: f.paga, diasParaVencer: diasEntre(hoje, f.vencimento) },
      usado: lim.usado,
      livre: lim.livre,
      abertas: abertas.map((x) => ({ fechamento: x.fechamento, vencimento: x.vencimento, total: x.total, pago: x.pago, restante: x.restante })),
      compras: compras.slice(0, 12).map((l) => linha(ctx, l)),
      comprasAMais: Math.max(0, compras.length - 12),
    };
  });
}

// ── metas (§6.5) ───────────────────────────────────────────────────────────

export function metas(d: DadosFinanceiros, hoje: Ymd) {
  return d.metas.map((m) => {
    const r = resumirMeta(m.itens, d.lancamentos.filter((l) => l.metaId === m.id), hoje);
    return { id: m.id, nome: m.nome, cor: m.cor, orcamento: m.orcamento, itens: m.itens.length, ...r };
  });
}

export function meta(d: DadosFinanceiros, id: string, hoje: Ymd) {
  const m = d.metas.find((x) => x.id === id);
  if (!m) return null;
  const ctx = contexto(d);
  const r: ResumoDeMeta = resumirMeta(m.itens, d.lancamentos.filter((l) => l.metaId === m.id), hoje);
  const grupos: { grupo: string; total: Centavos; itens: typeof m.itens }[] = [];
  for (const it of m.itens) {
    const g = it.grupo || "Sem grupo";
    let alvo = grupos.find((x) => x.grupo === g);
    if (!alvo) grupos.push((alvo = { grupo: g, total: 0, itens: [] }));
    alvo.itens.push(it);
    alvo.total += it.valor;
  }
  const formaDe = (it: (typeof m.itens)[number]) => {
    if (it.forma === "cartao") return `cartão ${ctx.cartoes.get(it.cartaoId ?? "")?.nome ?? ""}`.trim();
    if (it.forma === "boleto") return "boleto";
    if (it.forma === "carne") return "carnê";
    return ctx.contas.get(it.contaId ?? "")?.nome ?? "dinheiro";
  };
  return {
    id: m.id,
    nome: m.nome,
    descricao: m.descricao,
    cor: m.cor,
    orcamento: m.orcamento,
    ...r,
    etapas: [...new Set(m.itens.map((i) => i.grupo))],
    grupos: grupos.map((g) => ({ ...g, itens: g.itens.map((it) => ({ ...it, formaTexto: formaDe(it) })) })),
  };
}

// ── previsão e histórico (§6.6, §6.7) ──────────────────────────────────────

export function previsao(d: DadosFinanceiros, hoje: Ymd, lim: Limiares): Previsao & { temRenda: boolean } {
  return { ...preverMeses(paraMotor(d), hoje, lim), temRenda: d.renda > 0 };
}

export function historico(d: DadosFinanceiros, hoje: Ymd, meses = 12) {
  const ctx = contexto(d);
  const m = ctx.motor;
  const atual = mesDe(hoje);
  const serie = Array.from({ length: meses }, (_, i) => {
    const ym = somarMeses(atual, i - (meses - 1));
    const temMovimento = m.lancamentos.some((l) => mesDe(l.data) === ym);
    return { mes: ym, gasto: gastoDoMes(m.lancamentos, ym), entrada: entradaDoMes(m.lancamentos, ym), temMovimento, atual: ym === atual };
  });
  const comMov = serie.filter((s) => s.temMovimento);
  const media = comMov.length ? Math.round(comMov.reduce((s, x) => s + x.gasto, 0) / comMov.length) : 0;
  const ordenados = [...comMov].sort((a, b) => b.gasto - a.gasto);

  // categoria do mês contra a média dos 3 anteriores (§6.7)
  const ids = new Set<string | null>();
  const porMes = (ym: Ym) => new Map(gastoPorCategoria(m.lancamentos, ym).map((g) => [g.categoriaId, g.total]));
  const agora = porMes(atual);
  const anteriores = [1, 2, 3].map((i) => porMes(somarMeses(atual, -i)));
  for (const mp of [agora, ...anteriores]) for (const k of mp.keys()) ids.add(k);
  const comparacao = [...ids]
    .map((id) => {
      const mediaCat = anteriores.reduce((s, mp) => s + (mp.get(id) ?? 0), 0) / 3;
      const valor = agora.get(id) ?? 0;
      const diferenca = valor - mediaCat;
      const pct = mediaCat > 0 ? (diferenca / mediaCat) * 100 : valor > 0 ? 100 : 0;
      return { categoriaId: id, categoria: ctx.pastilha(id), media: Math.round(mediaCat), agora: valor, diferenca: Math.round(diferenca), pct };
    })
    .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
    .slice(0, 10);

  return {
    meses: serie,
    media,
    maisCaro: comMov.length >= 2 ? ordenados[0]! : null,
    maisLeve: comMov.length >= 2 ? ordenados[ordenados.length - 1]! : null,
    comparacao,
  };
}

// ── cadastros e ajustes (§6.8) ─────────────────────────────────────────────

export function cadastros(d: DadosFinanceiros, ym: Ym, hoje: Ymd, bytesDasFotos: number) {
  const ctx = contexto(d);
  const m = ctx.motor;
  const porCat = new Map<string, Centavos>();
  for (const l of d.lancamentos) {
    if (mesDe(l.data) !== ym || l.transferencia || !l.categoriaId) continue;
    porCat.set(l.categoriaId, (porCat.get(l.categoriaId) ?? 0) + l.valor);
  }
  return {
    renda: d.renda,
    teto: d.teto,
    contas: d.contas.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, cor: c.cor, saldoInicial: c.saldoInicial, saldo: saldoDaConta(c, m.lancamentos, hoje) })),
    cartoes: d.cartoes.map((c) => ({ id: c.id, nome: c.nome, cor: c.cor, limite: c.limite, fechamento: c.fechamento, vencimento: c.vencimento, contaPagamentoId: c.contaPagamentoId })),
    categorias: d.categorias.map((c) => ({ id: c.id, nome: c.nome, natureza: c.tipo, cor: c.cor, orcamento: c.orcamento, noMes: porCat.get(c.id) ?? 0, iniciais: iniciais(c.nome) })),
    atalhos: d.atalhos.map((a) => ({ ...a, categoria: ctx.pastilha(a.categoriaId) })),
    regras: d.regras.map((r) => ({ ...r, categoria: ctx.pastilha(r.categoriaId) })),
    totais: { lancamentos: d.lancamentos.length, contas: d.compromissos.length, metas: d.metas.length, bytesDasFotos },
  };
}
