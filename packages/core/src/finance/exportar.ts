import type { Ymd } from "./calendario";
import type { Centavos } from "./tipos";

/**
 * "Baixar CSV" (PRD §9.1). Separador ";" (não ",": vírgula já é o decimal
 * brasileiro), aspas em volta de cada valor com aspas internas duplicadas,
 * quebra de linha do Windows (CRLF) e BOM no início para o Excel abrir
 * acentos certo.
 */
export interface LinhaLancamentoCsv {
  data: Ymd;
  tipo: "despesa" | "receita";
  valor: Centavos;
  descricao: string;
  categoria: string;
  conta: string | null;
  cartao: string | null;
  transferencia: boolean;
}

const BOM = "﻿";
const CABECALHO = ["data", "tipo", "valor", "descricao", "categoria", "conta", "cartao", "transferencia"];

function aspas(valor: string): string {
  return `"${valor.replace(/"/g, '""')}"`;
}

/** Centavos (inteiro) para texto com vírgula decimal, sem separador de milhar (o CSV é para máquina reler, não para o olho). */
function formatarValor(centavos: Centavos): string {
  const abs = Math.abs(centavos);
  const reais = Math.trunc(abs / 100);
  const cent = abs % 100;
  const sinal = centavos < 0 ? "-" : "";
  return `${sinal}${reais},${String(cent).padStart(2, "0")}`;
}

function montarLinha(campos: string[]): string {
  return campos.map(aspas).join(";");
}

/**
 * Gera o conteúdo do "lancamentos.csv" (PRD §9.1). Ordena por data (o PRD
 * pede "em ordem de data"; ordenar aqui dentro poupa quem chama de lembrar
 * disso, e não custa nada se já vier ordenado).
 */
export function lancamentosCsv(linhas: LinhaLancamentoCsv[]): string {
  const ordenadas = [...linhas].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const corpo = ordenadas.map((l) =>
    montarLinha([
      l.data,
      l.tipo,
      formatarValor(l.valor),
      l.descricao,
      l.categoria,
      l.conta ?? "",
      l.cartao ?? "",
      l.transferencia ? "sim" : "nao",
    ]),
  );
  return `${BOM}${[montarLinha(CABECALHO), ...corpo].join("\r\n")}\r\n`;
}
