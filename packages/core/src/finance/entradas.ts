import { interpretarDitado, type Proposta } from "./ditado";
import { acharLinhaNoTexto, lerLinhaDigitavel } from "./boleto";
import { lerExtrato, regraAprendida, separarDuplicatas } from "./extrato";
import { lancamentosCsv } from "./exportar";
import { palpitarCategoria } from "./palpite";
import { RegraFinanceiraError } from "./operacoes";
import { paraMotor, type DadosFinanceiros } from "./dados";
import { extrato, type FiltrosDoExtrato } from "./visoes";
import { saldoTotal } from "./mes";
import { gerarExtratoPdf } from "./extrato-pdf";
import type { Limiares } from "./tipos";
import type { Ym, Ymd } from "./calendario";
import type { Centavos } from "./tipos";

/**
 * As entradas inteligentes (PRD §8): ditado, boleto e extrato. Os leitores
 * (`ditado.ts`, `boleto.ts`, `extrato.ts`) são puros e não conhecem o dono;
 * aqui eles recebem as contas, cartões, categorias e regras DELE. Nada grava:
 * o dono confere as propostas na tela e só então manda o comando.
 */

const categoriasDe = (d: DadosFinanceiros) => d.categorias.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo }));

export function proporDitado(d: DadosFinanceiros, texto: string, hoje: Ymd): Proposta[] {
  const propostas = interpretarDitado(texto, {
    hoje,
    contas: d.contas.map((c) => ({ id: c.id, nome: c.nome })),
    cartoes: d.cartoes.map((c) => ({ id: c.id, nome: c.nome })),
    categorias: categoriasDe(d),
    regras: d.regras,
  });
  if (!propostas.length) throw new RegraFinanceiraError("Não achei valor nenhum nessa frase. Diga quanto foi.");
  return propostas;
}

export interface BoletoLido {
  valor: Centavos;
  vencimento: Ymd | null;
  beneficiario: string | null;
  categoriaId: string | null;
  tipo: "bancario" | "arrecadacao";
}

/**
 * Boleto pela linha digitável ou pelo TEXTO já extraído do PDF (§8.2). O
 * valor e o vencimento saem dos números do código, não de OCR: por isso são
 * exatos.
 */
export function lerBoleto(d: DadosFinanceiros, entrada: { linha?: string | null; textoDoPdf?: string | null }, hoje: Ymd): BoletoLido {
  let valor: Centavos;
  let vencimento: Ymd | null;
  let tipo: BoletoLido["tipo"];
  let beneficiario: string | null = null;
  if (entrada.textoDoPdf !== undefined && entrada.textoDoPdf !== null) {
    const achado = acharLinhaNoTexto(entrada.textoDoPdf, hoje);
    if (!achado) throw new RegraFinanceiraError("Não consegui achar a linha digitável nesse PDF. Copie os 47 números do boleto e cole no campo acima.");
    ({ valor, vencimento, tipo } = achado.leitura);
    beneficiario = achado.beneficiario;
  } else {
    const leitura = lerLinhaDigitavel(entrada.linha ?? "", hoje);
    if (!leitura) throw new RegraFinanceiraError("Não achei um valor válido. Confira se copiou os 47 números inteiros.");
    ({ valor, vencimento, tipo } = leitura);
  }
  const categoriaId = palpitarCategoria(beneficiario ?? "", d.regras, categoriasDe(d), "despesa")
    ?? d.categorias.find((c) => c.tipo === "despesa")?.id ?? null;
  return { valor, vencimento, beneficiario, categoriaId, tipo };
}

export interface LinhaParaImportar {
  natureza: "despesa" | "receita";
  data: Ymd;
  valor: Centavos;
  descricao: string;
  categoriaId: string | null;
  /** a palavra que vira regra se o dono pedir para lembrar */
  regra: string | null;
}

/** Lê o CSV/OFX, separa o que já estava lançado e já traz o palpite de categoria de cada linha (§8.4). */
export function prepararImportacao(d: DadosFinanceiros, conteudo: string): { linhas: LinhaParaImportar[]; repetidas: number } {
  const lidas = lerExtrato(conteudo);
  if (!lidas.length) throw new RegraFinanceiraError("Não encontrei lançamentos nesse conteúdo.");
  const { novas, repetidas } = separarDuplicatas(lidas, d.lancamentos.map((l) => ({ data: l.data, valor: l.valor, descricao: l.descricao ?? "" })));
  if (!novas.length) throw new RegraFinanceiraError("Tudo desse arquivo já estava lançado.");
  const cats = categoriasDe(d);
  return {
    linhas: novas.map((l) => ({
      natureza: l.tipo,
      data: l.data,
      valor: l.valor,
      descricao: l.descricao,
      categoriaId: palpitarCategoria(l.descricao, d.regras, cats, l.tipo),
      regra: regraAprendida(l.descricao),
    })),
    repetidas: repetidas.length,
  };
}

/**
 * O extrato do mês em PDF, com os MESMOS filtros da tela (§6.2.1). A visão é a
 * da tela (`visoes.extrato`), e o gerador só desenha.
 */
export async function extratoPdfDosDados(d: DadosFinanceiros, ym: Ym, hoje: Ymd, lim: Limiares, f: FiltrosDoExtrato, titular?: string | null): Promise<Uint8Array> {
  const e = extrato(d, ym, hoje, lim, f);
  const filtros = [
    f.natureza === "despesa" ? "Só saídas" : f.natureza === "receita" ? "Só entradas" : null,
    f.categoriaId ? d.categorias.find((c) => c.id === f.categoriaId)?.nome : null,
    f.onde?.startsWith("cartao:") ? `Cartão ${d.cartoes.find((c) => `cartao:${c.id}` === f.onde)?.nome ?? ""}` : f.onde ? d.contas.find((c) => `conta:${c.id}` === f.onde)?.nome : null,
    f.busca ? `contém "${f.busca}"` : null,
  ].filter(Boolean).join(" · ");
  return gerarExtratoPdf({ mes: ym, hoje, resumo: e.resumo, previstos: e.previstos, dias: e.dias, saldoContas: saldoTotal(d.contas, paraMotor(d).lancamentos, hoje), filtros, titular });
}

/** "lancamentos.csv" com todos os lançamentos (§9.1). */
export function csvDoFinanceiro(d: DadosFinanceiros): string {
  const cat = new Map(d.categorias.map((c) => [c.id, c.nome]));
  const conta = new Map(d.contas.map((c) => [c.id, c.nome]));
  const cartao = new Map(d.cartoes.map((c) => [c.id, c.nome]));
  return lancamentosCsv(
    d.lancamentos.map((l) => ({
      data: l.data,
      tipo: l.tipo,
      valor: l.valor,
      descricao: l.descricao ?? "",
      categoria: cat.get(l.categoriaId ?? "") ?? "",
      conta: l.contaId ? (conta.get(l.contaId) ?? null) : null,
      cartao: l.cartaoId ? (cartao.get(l.cartaoId) ?? null) : null,
      transferencia: l.transferencia,
    })),
  );
}
