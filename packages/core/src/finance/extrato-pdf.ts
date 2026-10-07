import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { brl, dataLonga, diaDaSemana, mesLongo } from "./formato";
import type { Ym, Ymd } from "./calendario";
import type { Centavos } from "./tipos";
import type { LinhaDeConta, LinhaDeLancamento } from "./visoes";

/**
 * O extrato do mês em PDF, para guardar, mandar ao contador ou anexar.
 *
 * Recebe a MESMA visão que a tela de Extrato desenha (`visoes.extrato`), com
 * os mesmos filtros: o PDF não recalcula nada, então não tem como divergir do
 * que o dono vê. Puro (sem banco): devolve os bytes, e quem chama decide se
 * baixa (rota), manda no WhatsApp ou anexa.
 *
 * As fontes padrão do PDF cobrem o português inteiro (Latin-1), mas não emoji
 * nem o sinal de menos tipográfico: o texto passa por `seguro` antes de ir
 * para a página, senão a biblioteca recusa o documento inteiro.
 */

export interface ExtratoParaPdf {
  mes: Ym;
  hoje: Ymd;
  resumo: { n: number; saidas: Centavos; entradas: Centavos; previstos: number; aPagar: Centavos; aReceber: Centavos };
  previstos: LinhaDeConta[];
  dias: { data: Ymd; totalSaidas: Centavos; itens: LinhaDeLancamento[] }[];
  /** "Tenho na conta" hoje, somando as contas */
  saldoContas: Centavos;
  /** os filtros em texto ("Só saídas · Mercado"), vazio sem filtro */
  filtros?: string | null;
  /** quem é o dono, para o cabeçalho */
  titular?: string | null;
}

const COR = {
  tinta: rgb(0.12, 0.16, 0.15),
  apagada: rgb(0.42, 0.46, 0.44),
  linha: rgb(0.85, 0.87, 0.86),
  fundo: rgb(0.95, 0.96, 0.95),
  marca: rgb(0.13, 0.31, 0.24),
  saida: rgb(0.65, 0.22, 0.17),
  entrada: rgb(0.11, 0.42, 0.27),
};

// o que a WinAnsi (fontes padrão do PDF) tem além do Latin-1
const EXTRAS_WINANSI = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** Texto que a fonte padrão consegue desenhar: o resto vira equivalente ou some. Pura. */
export function seguro(texto: string): string {
  return [...texto
    .replace(/[−‒]/g, "-")
    .replace(/[  ]/g, " ")]
    .filter((c) => c.charCodeAt(0) <= 0xff || EXTRAS_WINANSI.includes(c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 42;
const LARGURA_UTIL = A4.largura - MARGEM * 2;

class Folha {
  pagina!: PDFPage;
  y = 0;
  readonly paginas: PDFPage[] = [];
  constructor(private doc: PDFDocument, readonly normal: PDFFont, readonly negrito: PDFFont) {
    this.novaPagina();
  }

  novaPagina() {
    this.pagina = this.doc.addPage([A4.largura, A4.altura]);
    this.paginas.push(this.pagina);
    this.y = A4.altura - MARGEM;
  }

  /** Garante espaço; sem espaço, vira a página (o rodapé reserva 30 pt). */
  cabe(altura: number) {
    if (this.y - altura < MARGEM + 30) this.novaPagina();
  }

  texto(t: string, x: number, o: { tamanho?: number; fonte?: PDFFont; cor?: RGB; largura?: number; direita?: boolean } = {}) {
    const fonte = o.fonte ?? this.normal;
    const tamanho = o.tamanho ?? 10;
    let s = seguro(t);
    if (o.largura) s = cortar(s, fonte, tamanho, o.largura);
    const w = fonte.widthOfTextAtSize(s, tamanho);
    this.pagina.drawText(s, { x: o.direita ? x - w : x, y: this.y, size: tamanho, font: fonte, color: o.cor ?? COR.tinta });
  }

  linha(cor = COR.linha) {
    this.pagina.drawLine({ start: { x: MARGEM, y: this.y }, end: { x: A4.largura - MARGEM, y: this.y }, thickness: 0.6, color: cor });
  }
}

function cortar(s: string, fonte: PDFFont, tamanho: number, largura: number): string {
  if (fonte.widthOfTextAtSize(s, tamanho) <= largura) return s;
  let fim = s.length;
  while (fim > 1 && fonte.widthOfTextAtSize(`${s.slice(0, fim)}…`, tamanho) > largura) fim--;
  return `${s.slice(0, fim).trimEnd()}…`;
}

const sinal = (l: LinhaDeLancamento) => (l.transferencia ? "" : l.natureza === "despesa" ? "- " : "+ ");
const corDoValor = (l: LinhaDeLancamento) => (l.transferencia ? COR.apagada : l.natureza === "despesa" ? COR.saida : COR.entrada);

export async function gerarExtratoPdf(e: ExtratoParaPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(seguro(`Extrato de ${mesLongo(e.mes)}`));
  doc.setCreator("Órbita");
  doc.setProducer("Órbita");
  const f = new Folha(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  const direita = A4.largura - MARGEM;

  // cabeçalho
  f.texto("Extrato", MARGEM, { tamanho: 22, fonte: f.negrito, cor: COR.marca });
  f.texto(`Gerado em ${dataLonga(e.hoje)}`, direita, { tamanho: 9, cor: COR.apagada, direita: true });
  f.y -= 20;
  f.texto(mesLongo(e.mes).replace(/^./, (c) => c.toUpperCase()), MARGEM, { tamanho: 13, cor: COR.tinta });
  if (e.titular) f.texto(e.titular, direita, { tamanho: 9, cor: COR.apagada, direita: true });
  f.y -= 14;
  if (e.filtros) {
    f.texto(`Filtros: ${e.filtros}`, MARGEM, { tamanho: 9, cor: COR.apagada, largura: LARGURA_UTIL });
    f.y -= 14;
  }

  // resumo em quatro caixas
  f.y -= 6;
  const caixas: [string, Centavos, RGB][] = [
    ["Entradas", e.resumo.entradas, COR.entrada],
    ["Saídas", e.resumo.saidas, COR.saida],
    ["Resultado do mês", e.resumo.entradas - e.resumo.saidas, e.resumo.entradas - e.resumo.saidas < 0 ? COR.saida : COR.entrada],
    ["Tenho nas contas hoje", e.saldoContas, e.saldoContas < 0 ? COR.saida : COR.tinta],
  ];
  const larguraCaixa = (LARGURA_UTIL - 3 * 8) / 4;
  caixas.forEach(([rotulo, valor, cor], i) => {
    const x = MARGEM + i * (larguraCaixa + 8);
    f.pagina.drawRectangle({ x, y: f.y - 38, width: larguraCaixa, height: 46, color: COR.fundo, borderColor: COR.linha, borderWidth: 0.6 });
    const y0 = f.y;
    f.y = y0 - 6;
    f.texto(rotulo, x + 8, { tamanho: 8, cor: COR.apagada, largura: larguraCaixa - 16 });
    f.y = y0 - 24;
    f.texto(brl(valor), x + 8, { tamanho: 12, fonte: f.negrito, cor, largura: larguraCaixa - 16 });
    f.y = y0;
  });
  f.y -= 58;

  // previsto (contas em aberto do mês)
  if (e.previstos.length) {
    f.cabe(40);
    f.texto("Previsto para o mês (ainda não aconteceu)", MARGEM, { tamanho: 11, fonte: f.negrito });
    f.y -= 8;
    f.linha();
    f.y -= 14;
    for (const c of e.previstos) {
      f.cabe(16);
      f.texto(`${c.direcao === "pagar" ? "vence" : "recebe"} ${dataLonga(c.vencimento).slice(0, 5)}`, MARGEM, { tamanho: 9, cor: COR.apagada });
      f.texto(c.descricao, MARGEM + 70, { tamanho: 10, largura: LARGURA_UTIL - 70 - 110 });
      f.texto(`${c.direcao === "pagar" ? "- " : "+ "}${brl(c.valor)}`, direita, { tamanho: 10, cor: c.direcao === "pagar" ? COR.saida : COR.entrada, direita: true });
      f.y -= 15;
    }
    f.y -= 10;
  }

  // lançamentos, por dia
  f.cabe(40);
  f.texto("Lançamentos", MARGEM, { tamanho: 11, fonte: f.negrito });
  f.texto(`${e.resumo.n} ${e.resumo.n === 1 ? "lançamento" : "lançamentos"}`, direita, { tamanho: 9, cor: COR.apagada, direita: true });
  f.y -= 8;
  f.linha();
  f.y -= 16;
  if (!e.dias.length) {
    f.texto("Nenhum lançamento neste mês com esses filtros.", MARGEM, { tamanho: 10, cor: COR.apagada });
    f.y -= 16;
  }
  for (const dia of e.dias) {
    // o cabeçalho do dia nunca fica sozinho no pé da página
    f.cabe(18 + 26);
    f.pagina.drawRectangle({ x: MARGEM, y: f.y - 5, width: LARGURA_UTIL, height: 17, color: COR.fundo });
    f.texto(`${diaDaSemana(dia.data)}, ${dataLonga(dia.data)}`, MARGEM + 6, { tamanho: 9, fonte: f.negrito, cor: COR.apagada });
    if (dia.totalSaidas) f.texto(`saídas ${brl(dia.totalSaidas)}`, direita - 6, { tamanho: 9, cor: COR.apagada, direita: true });
    f.y -= 20;
    for (const l of dia.itens) {
      f.cabe(26);
      f.texto(l.titulo, MARGEM + 6, { tamanho: 10, largura: LARGURA_UTIL - 130 });
      f.texto(`${sinal(l)}${brl(l.valor)}`, direita - 6, { tamanho: 10, fonte: f.negrito, cor: corDoValor(l), direita: true });
      f.y -= 11;
      const detalhe = [l.categoria?.nome, l.onde, l.parcelaDe && l.parcelaDe > 1 ? `parcela ${l.parcelaN}/${l.parcelaDe}` : null, l.transferencia ? "transferência" : null, l.estorno ? "estorno" : null]
        .filter(Boolean)
        .join(" · ");
      if (detalhe) f.texto(detalhe, MARGEM + 6, { tamanho: 8, cor: COR.apagada, largura: LARGURA_UTIL - 130 });
      f.y -= 15;
    }
  }

  // rodapé com a paginação, depois de saber quantas páginas são
  const total = f.paginas.length;
  f.paginas.forEach((p, i) => {
    const rodape = seguro(`Órbita · ${mesLongo(e.mes)} · página ${i + 1} de ${total}`);
    const w = f.normal.widthOfTextAtSize(rodape, 8);
    p.drawText(rodape, { x: A4.largura / 2 - w / 2, y: MARGEM - 14, size: 8, font: f.normal, color: COR.apagada });
  });
  return doc.save();
}
