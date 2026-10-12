import * as XLSX from "xlsx";
import { tabelaMarkdown } from "../texto";

/**
 * Planilha (XLSX, XLSM, XLS, ODS): cada aba vira uma tabela Markdown com o nome
 * da aba, até `linhasMax` linhas. O SheetJS lê o valor JÁ CALCULADO de cada
 * fórmula e nunca executa macro (o VBA do XLSM nem é aberto).
 *
 * `sheetRows` corta na leitura, não depois: uma planilha de um milhão de
 * linhas não é montada inteira na memória para jogar 998 mil fora.
 *
 * A versão do SheetJS vem do CDN oficial (0.20.3), não do npm: a do npm parou
 * na 0.18.5, que tem as falhas de poluição de protótipo (CVE-2023-30533) e de
 * ReDoS (CVE-2024-22363) corrigidas só nas versões publicadas no CDN.
 */

export class PlanilhaProtegidaError extends Error {
  constructor() {
    super("A planilha tem senha.");
    this.name = "PlanilhaProtegidaError";
  }
}

export interface PlanilhaLida {
  texto: string;
  partes: string[];
  tabelas: number;
  resumo: string;
  avisos: string[];
}

function linhasUteis(linhas: unknown[][]): unknown[][] {
  const naoVazia = (l: unknown[]) => l.some((c) => c !== null && c !== undefined && String(c).trim() !== "");
  const out = linhas.filter(naoVazia);
  // colunas vazias no fim de todas as linhas (formatação arrastada) saem
  let largura = 0;
  for (const l of out) {
    for (let i = l.length - 1; i >= 0; i--) {
      if (l[i] !== null && l[i] !== undefined && String(l[i]).trim() !== "") {
        largura = Math.max(largura, i + 1);
        break;
      }
    }
  }
  return out.map((l) => l.slice(0, largura));
}

function valor(v: unknown): unknown {
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
  }
  return v;
}

export function lerPlanilha(bytes: Buffer, linhasMax: number, nomeDoFormato = "Planilha"): PlanilhaLida {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "buffer", cellDates: true, sheetRows: linhasMax + 1, cellFormula: false, cellHTML: false, bookVBA: false });
  } catch (e) {
    if (/password|encrypt/i.test(e instanceof Error ? e.message : String(e))) throw new PlanilhaProtegidaError();
    throw e;
  }
  const partes: string[] = [];
  const avisos: string[] = [];
  let tabelas = 0;
  const resumoAbas: string[] = [];
  for (const [i, nome] of wb.SheetNames.entries()) {
    const aba = wb.Sheets[nome];
    if (!aba) continue;
    const linhas = linhasUteis((XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, raw: true, defval: null, blankrows: false }) as unknown[][]).map((l) => l.map(valor)));
    // `!fullref` é o tamanho real da aba, mesmo com a leitura cortada em `sheetRows`
    const real = aba["!fullref"] ? XLSX.utils.decode_range(aba["!fullref"] as string).e.r + 1 : linhas.length;
    // a aba vai pelo NÚMERO: o nome é de quem montou a planilha, e o aviso não vai embrulhado (o resumo, com os nomes, vai)
    if (real > linhasMax) avisos.push(`A aba ${i + 1} tem ${real} linhas; li as primeiras ${linhasMax}.`);
    if (!linhas.length) {
      resumoAbas.push(`${nome} (vazia)`);
      continue;
    }
    tabelas++;
    resumoAbas.push(`${nome} (${Math.min(linhas.length, linhasMax)} linha(s))`);
    partes.push(`## Aba: ${nome}\n\n${tabelaMarkdown(linhas.slice(0, linhasMax))}`);
  }
  return {
    texto: partes.join("\n\n"),
    partes,
    tabelas,
    resumo: `${nomeDoFormato} com ${wb.SheetNames.length} aba(s): ${resumoAbas.join(", ")}.`,
    avisos,
  };
}

/**
 * A planilha inteira em CSV (`;`), aba por aba, para o leitor de extrato
 * (`finance/extrato.ts`): data em AAAA-MM-DD, número com ponto decimal, sem o
 * corte de `linhasMax`. O teto aqui é o do texto (`textoMax`), que o
 * extrator aplica depois. PURO (fora o SheetJS).
 */
export function planilhaComoCsv(bytes: Buffer): { texto: string; abas: number; linhas: number } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "buffer", cellDates: true, cellFormula: false, cellHTML: false, bookVBA: false });
  } catch (e) {
    if (/password|encrypt/i.test(e instanceof Error ? e.message : String(e))) throw new PlanilhaProtegidaError();
    throw e;
  }
  const blocos: string[] = [];
  let linhas = 0;
  for (const nome of wb.SheetNames) {
    const aba = wb.Sheets[nome];
    if (!aba) continue;
    const dados = linhasUteis((XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, raw: true, defval: null, blankrows: false }) as unknown[][]).map((l) => l.map(valor)));
    linhas += dados.length;
    // o separador nunca aparece dentro da célula: um ";" na descrição viraria coluna nova
    blocos.push(dados.map((l) => l.map((c) => (c === null || c === undefined ? "" : String(c).replace(/[;\r\n]+/g, " "))).join(";")).join("\n"));
  }
  return { texto: blocos.join("\n"), abas: wb.SheetNames.length, linhas };
}
