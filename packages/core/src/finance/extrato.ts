import type { Ymd } from "./calendario";
import type { Centavos } from "./tipos";

/**
 * Leitura de extrato bancário (PRD §8.4): OFX de verdade, ou CSV de banco (o
 * formato varia de banco para banco, então a leitura é por HEURÍSTICA, não
 * por um layout fixo). Nada de rede, nada de banco: o arquivo já chegou como
 * texto, quem chamou decide o que fazer com o resultado.
 */
export interface LinhaExtrato {
  data: Ymd;
  valor: Centavos;
  tipo: "despesa" | "receita";
  descricao: string;
}

function ehOfx(conteudo: string): boolean {
  return /<STMTTRN>/i.test(conteudo);
}

function dataOfx(bruto: string): Ymd | null {
  const m = bruto.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** OFX é SGML: as tags nem sempre fecham, então cada campo é lido isoladamente dentro do bloco. */
function lerOfx(conteudo: string): LinhaExtrato[] {
  const blocos = conteudo.split(/<STMTTRN>/i).slice(1);
  const linhas: LinhaExtrato[] = [];
  for (const bloco of blocos) {
    const corpo = bloco.split(/<\/STMTTRN>/i)[0] ?? bloco;
    const dtBruto = corpo.match(/<DTPOSTED>\s*([^\s<]+)/i)?.[1];
    const valorBruto = corpo.match(/<TRNAMT>\s*([^\s<]+)/i)?.[1];
    const memo = corpo.match(/<MEMO>\s*([^\r\n<]+)/i)?.[1]?.trim();
    const name = corpo.match(/<NAME>\s*([^\r\n<]+)/i)?.[1]?.trim();
    if (!dtBruto || !valorBruto) continue;
    const data = dataOfx(dtBruto);
    const valorNum = Number(valorBruto.replace(",", "."));
    if (!data || !valorNum || Number.isNaN(valorNum)) continue; // valor zero é ignorado (PRD §8.4)
    linhas.push({
      data,
      valor: Math.round(Math.abs(valorNum) * 100),
      tipo: valorNum < 0 ? "despesa" : "receita",
      descricao: memo || name || "Lançamento importado",
    });
  }
  return linhas;
}

interface AcheData {
  ymd: Ymd;
  coluna: number;
}

/** Primeira coluna que parece data, nos 4 formatos do PRD (aaaa-mm-dd, dd/mm/aaaa, dd/mm/aa, aaaammdd). */
function acharData(colunas: string[]): AcheData | null {
  for (let i = 0; i < colunas.length; i++) {
    const c = colunas[i]!;
    let m = c.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return { ymd: `${m[1]}-${m[2]}-${m[3]}`, coluna: i };
    m = c.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return { ymd: `${m[3]}-${m[2]}-${m[1]}`, coluna: i };
    m = c.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (m) return { ymd: `20${m[3]}-${m[2]}-${m[1]}`, coluna: i };
    m = c.match(/^(\d{8})$/);
    if (m) return { ymd: `${m[1]!.slice(0, 4)}-${m[1]!.slice(4, 6)}-${m[1]!.slice(6, 8)}`, coluna: i };
  }
  return null;
}

/** "1.234,56", "-45,90", "1234.56": vírgula decimal entende ponto como milhar; sem vírgula, ponto é decimal. */
function paraNumero(bruto: string): number | null {
  const t0 = bruto.trim();
  if (!/\d/.test(t0)) return null;
  const negativo = /^-/.test(t0) || /^\(.*\)$/.test(t0);
  let t = t0.replace(/^[-(]/, "").replace(/\)$/, "");
  t = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return negativo ? -Math.abs(n) : n;
}

interface AcheValor {
  valor: number;
  coluna: number;
}

/** Da última coluna para a primeira, a primeira que tem dígito, não é a de data, e vira número diferente de zero. */
function acharValor(colunas: string[], colunaData: number): AcheValor | null {
  for (let i = colunas.length - 1; i >= 0; i--) {
    if (i === colunaData) continue;
    const c = colunas[i]!;
    if (!/\d/.test(c)) continue;
    const n = paraNumero(c);
    if (n !== null && n !== 0) return { valor: n, coluna: i };
  }
  return null;
}

/** A coluna mais longa com letras, fora a de data e a de valor; padrão "Lançamento importado". */
function acharDescricao(colunas: string[], colunaData: number, colunaValor: number): string {
  let melhor = "";
  for (let i = 0; i < colunas.length; i++) {
    if (i === colunaData || i === colunaValor) continue;
    const c = colunas[i]!;
    if (/\p{L}/u.test(c) && c.length > melhor.length) melhor = c;
  }
  return melhor || "Lançamento importado";
}

function lerCsv(conteudo: string): LinhaExtrato[] {
  const linhasTexto = conteudo.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhasTexto.length === 0) return [];
  const primeira = linhasTexto[0]!;
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";

  const resultado: LinhaExtrato[] = [];
  for (const linha of linhasTexto) {
    const colunas = linha.split(sep).map((c) => {
      const t = c.trim();
      // aspas em volta da coluna somem; aspas internas duplicadas (padrão CSV) viram uma só
      return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
    });
    const data = acharData(colunas);
    if (!data) continue; // sem data: descarta a linha (é assim que o cabeçalho some sozinho)
    const valor = acharValor(colunas, data.coluna);
    if (!valor) continue;
    const descricao = acharDescricao(colunas, data.coluna, valor.coluna);
    resultado.push({
      data: data.ymd,
      valor: Math.round(Math.abs(valor.valor) * 100),
      tipo: valor.valor < 0 ? "despesa" : "receita",
      descricao,
    });
  }
  return resultado;
}

/** OFX (por `<STMTTRN>`) ou CSV (heurística de separador, data e valor). */
export function lerExtrato(conteudo: string): LinhaExtrato[] {
  return ehOfx(conteudo) ? lerOfx(conteudo) : lerCsv(conteudo);
}

export interface LancamentoExistente {
  data: Ymd;
  valor: Centavos;
  descricao?: string;
}

export interface Duplicatas {
  novas: LinhaExtrato[];
  repetidas: LinhaExtrato[];
}

/** Duplicata: mesma data, mesmo valor (diferença menor que meio centavo) e mesma descrição sem diferenciar maiúsculas (PRD §8.4). */
export function separarDuplicatas(linhas: LinhaExtrato[], existentes: LancamentoExistente[]): Duplicatas {
  const novas: LinhaExtrato[] = [];
  const repetidas: LinhaExtrato[] = [];
  for (const l of linhas) {
    const ehDuplicata = existentes.some(
      (e) => e.data === l.data && Math.abs(e.valor - l.valor) < 0.5 && (e.descricao ?? "").toLowerCase() === l.descricao.toLowerCase(),
    );
    (ehDuplicata ? repetidas : novas).push(l);
  }
  return { novas, repetidas };
}

/** Primeira palavra com mais de 3 letras, para virar "contém {palavra}" (PRD §8.4: "lembrar destas categorias"). */
export function regraAprendida(descricao: string): string | null {
  const palavras = descricao.trim().split(/\s+/);
  for (const p of palavras) {
    const limpa = p.replace(/[^\p{L}0-9]/gu, "");
    if (limpa.length > 3) return limpa;
  }
  return null;
}
