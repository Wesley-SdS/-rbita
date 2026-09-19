import type { ItemTexto } from "./pdf";

/**
 * TABELA VIRA TABELA, NÃO TEXTO CORRIDO.
 *
 * Num PDF nativo, o pdf.js entrega cada pedaço de texto com a posição (x, y).
 * Um extrato ou uma fatura viram, na leitura ingênua, uma fileira de números
 * sem cabeçalho: "27/08/2026 427,16 30 08/2026". Quem lê depois (o modelo, o
 * dono) não sabe qual número é qual coluna.
 *
 * Aqui as posições são usadas para remontar linhas e colunas e devolver
 * Markdown, com o cabeçalho repetido em cada pedaço quando a tabela é longa,
 * que é como um trecho de tabela continua fazendo sentido sozinho na busca.
 *
 * Só funciona em PDF com camada de texto; página escaneada é assunto do modelo
 * de visão, que recebe a instrução de devolver a tabela em Markdown.
 */

export interface Celula {
  texto: string;
  x: number;
}

export interface LinhaDetectada {
  y: number;
  celulas: Celula[];
}

/** Agrupa itens em linhas por proximidade vertical. Puro. */
export function agruparEmLinhas(itens: ItemTexto[], tolerancia?: number): LinhaDetectada[] {
  if (!itens.length) return [];
  const alturas = itens.map((i) => i.altura).filter((a) => a > 0).sort((a, b) => a - b);
  const alturaMediana = alturas[Math.floor(alturas.length / 2)] ?? 10;
  const tol = tolerancia ?? Math.max(1, alturaMediana * 0.6);

  const linhas: LinhaDetectada[] = [];
  for (const item of [...itens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const linha = linhas.find((l) => Math.abs(l.y - item.y) <= tol);
    if (linha) {
      linha.celulas.push({ texto: item.texto.trim(), x: item.x });
    } else {
      linhas.push({ y: item.y, celulas: [{ texto: item.texto.trim(), x: item.x }] });
    }
  }
  for (const linha of linhas) linha.celulas.sort((a, b) => a.x - b.x);
  return linhas;
}

/**
 * Sequências de linhas com o mesmo número de colunas e colunas alinhadas são
 * tabela. Menos de `minLinhas` seguidas não é tabela, é coincidência.
 */
export function detectarTabelas(linhas: LinhaDetectada[], minLinhas: number, minColunas: number, toleranciaX = 12): LinhaDetectada[][] {
  const tabelas: LinhaDetectada[][] = [];
  let atual: LinhaDetectada[] = [];

  const alinhadas = (a: LinhaDetectada, b: LinhaDetectada) => {
    if (a.celulas.length !== b.celulas.length) return false;
    return a.celulas.every((c, i) => Math.abs(c.x - b.celulas[i]!.x) <= toleranciaX);
  };

  for (const linha of linhas) {
    if (linha.celulas.length < minColunas) {
      if (atual.length >= minLinhas) tabelas.push(atual);
      atual = [];
      continue;
    }
    if (!atual.length || alinhadas(atual.at(-1)!, linha)) {
      atual.push(linha);
    } else {
      if (atual.length >= minLinhas) tabelas.push(atual);
      atual = [linha];
    }
  }
  if (atual.length >= minLinhas) tabelas.push(atual);
  return tabelas;
}

const escapar = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** Linhas detectadas viram Markdown, a primeira como cabeçalho. Puro. */
export function paraMarkdown(tabela: LinhaDetectada[]): string {
  if (!tabela.length) return "";
  const colunas = tabela[0]!.celulas.length;
  const cabecalho = tabela[0]!.celulas.map((c) => escapar(c.texto) || " ");
  const corpo = tabela.slice(1).map((l) => l.celulas.map((c) => escapar(c.texto)));
  const linhas = [`| ${cabecalho.join(" | ")} |`, `| ${Array(colunas).fill("---").join(" | ")} |`];
  for (const linha of corpo) linhas.push(`| ${linha.join(" | ")} |`);
  return linhas.join("\n");
}

export interface TextoDaPagina {
  texto: string;
  tabelas: number;
}

/**
 * Texto da página com as tabelas em Markdown. O que não faz parte de tabela
 * continua como texto corrido, na ordem de leitura.
 */
export function textoComTabelas(itens: ItemTexto[], textoOriginal: string, opcoes: { minLinhas: number; minColunas: number }): TextoDaPagina {
  if (!itens.length) return { texto: textoOriginal, tabelas: 0 };
  const linhas = agruparEmLinhas(itens);
  const tabelas = detectarTabelas(linhas, opcoes.minLinhas, opcoes.minColunas);
  if (!tabelas.length) return { texto: textoOriginal, tabelas: 0 };

  const dentroDeTabela = new Set(tabelas.flat());
  const partes: string[] = [];
  let buffer: string[] = [];
  const despejarTexto = () => {
    if (buffer.length) partes.push(buffer.join("\n"));
    buffer = [];
  };

  for (const linha of linhas) {
    if (dentroDeTabela.has(linha)) {
      const tabela = tabelas.find((t) => t[0] === linha);
      if (tabela) {
        despejarTexto();
        partes.push(paraMarkdown(tabela));
      }
      continue;
    }
    buffer.push(linha.celulas.map((c) => c.texto).join(" ").trim());
  }
  despejarTexto();
  return { texto: partes.filter(Boolean).join("\n\n"), tabelas: tabelas.length };
}
