import { diasEntre, partes, somarDias, type Ymd } from "./calendario";
import type { Centavos } from "./tipos";

/**
 * Leitura de boleto (PRD §8.2), sem OCR e sem rede: quem já extraiu o texto
 * do PDF (unpdf/OCR do projeto) entrega aqui, este arquivo só lê dígitos.
 */

const BASE_FATOR = "1997-10-07";
const REINICIO_DIAS = 9000;
const LIMITE_PASSADO_DIAS = 1100;
const VALOR_MAXIMO: Centavos = 500_000_000; // 5 milhões de reais em centavos

export type TipoLeitura = "bancario" | "arrecadacao";

export interface LeituraBoleto {
  valor: Centavos;
  vencimento: Ymd | null;
  tipo: TipoLeitura;
}

/**
 * Boleto bancário (47 dígitos, PRD §8.2): fator de vencimento nas posições
 * 34-37 (1-indexado) e valor nas posições 38-47. O fator reinicia a partir de
 * 2025 (a base 1997-10-07 + o maior fator possível não alcança mais o
 * presente); quando a data cair mais de 1.100 dias no passado, soma-se 9.000
 * dias, até 5 vezes, replicando o comportamento observado no app original.
 */
function lerBancario(d47: string, hoje: Ymd): LeituraBoleto | null {
  const fator = Number(d47.slice(33, 37));
  const valor = Number(d47.slice(37, 47));
  if (!(valor > 0 && valor <= VALOR_MAXIMO)) return null;

  let vencimento: Ymd | null = null;
  if (fator > 0) {
    let venc = somarDias(BASE_FATOR, fator);
    for (let i = 0; i < 5 && diasEntre(venc, hoje) > LIMITE_PASSADO_DIAS; i++) {
      venc = somarDias(venc, REINICIO_DIAS);
    }
    const ano = partes(venc).y;
    if (ano >= 1997 && ano <= 2099) vencimento = venc;
  }
  return { valor, vencimento, tipo: "bancario" };
}

/**
 * Boleto de arrecadação/concessionária (48 dígitos, começa com 8; PRD §8.2,
 * ponto de atenção 6). Não é o mesmo layout do bancário, e o app original não
 * suportava; aqui vai a leitura correta.
 *
 * A LINHA DIGITÁVEL de arrecadação é o código de barras de 44 dígitos
 * reorganizado em 4 blocos de 11 dígitos, cada um seguido de 1 dígito
 * verificador (módulo 10) — 4 × 12 = 48. Reconstruir o código de barras é
 * remover o 12º caractere (o DV) de cada bloco e concatenar os 4 blocos de
 * 11: `[0:11] + [12:23] + [24:35] + [36:47]` (dentro da linha de 48).
 *
 * No código de barras de 44 dígitos reconstruído:
 * - posição 1: sempre "8" (produto arrecadação).
 * - posição 2: segmento (prefeitura, saneamento, energia...).
 * - posição 3: identificador de valor. "6" ou "8" = valor efetivo em reais
 *   (as posições 5-15, 11 dígitos, são o valor em CENTAVOS, exatamente como
 *   no bancário: o inteiro já É o valor×100, sem precisar dividir). "7" ou
 *   "9" = valor referência, que precisa de uma tabela de fator por convênio
 *   que o PRD não especifica; não suportado aqui (devolve null).
 * - vencimento: o PRD pede explicitamente "sem vencimento confiável" para
 *   este formato — o campo de data, quando existe, muda de posição por
 *   segmento (varejo, tributos...) e não há uma tabela única e confiável
 *   como a do bancário. Por isso `vencimento` é sempre `null` aqui: melhor
 *   admitir que não sabemos do que inventar uma data errada.
 *
 * Não valida os dígitos verificadores (nem o bancário valida): o objetivo é
 * ler o valor de um boleto que o dono colou ou tirou de PDF, não auditar o
 * código de barras.
 */
function lerArrecadacao(d48: string): LeituraBoleto | null {
  const blocos = [d48.slice(0, 12), d48.slice(12, 24), d48.slice(24, 36), d48.slice(36, 48)];
  const codigoBarras = blocos.map((b) => b.slice(0, 11)).join("");
  const identificadorValor = codigoBarras[2];
  if (identificadorValor !== "6" && identificadorValor !== "8") return null;

  const valor = Number(codigoBarras.slice(4, 15));
  if (!(valor > 0 && valor <= VALOR_MAXIMO)) return null;
  return { valor, vencimento: null, tipo: "arrecadacao" };
}

/**
 * Lê uma linha digitável, bancária (47 dígitos) ou de arrecadação (48
 * dígitos, começando com 8). Remove tudo que não é dígito antes de decidir.
 */
export function lerLinhaDigitavel(texto: string, hoje: Ymd): LeituraBoleto | null {
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length >= 48 && digitos[0] === "8") return lerArrecadacao(digitos.slice(0, 48));
  if (digitos.length >= 47) return lerBancario(digitos.slice(0, 47), hoje);
  return null;
}

/** Sequências candidatas: dígitos com pontos, espaços e traços, de 46 a 82 caracteres (PRD §8.2). */
const CANDIDATO_RE = /[\d.\-\s]{46,82}/g;

function acharBeneficiario(textoDoPdf: string): string | null {
  const m = textoDoPdf.match(/(?:cedente|benefici[aá]rio)\s*[:\-]?\s*([\p{L}0-9 .,&'-]{5,41})/iu);
  if (!m?.[1]) return null;
  const nome = m[1].trim();
  return nome.length >= 5 ? nome : null;
}

/**
 * Acha e lê a linha digitável dentro de um texto (extraído de PDF em outro
 * lugar do projeto). Testa janelas de 47 dígitos (bancário) começando nas
 * posições 0 a 11 de cada sequência candidata, e o mesmo para janelas de 48
 * começando com "8" (arrecadação). Prefere a primeira leitura válida que
 * tenha vencimento; senão, a primeira válida de qualquer tipo.
 */
export function acharLinhaNoTexto(textoDoPdf: string, hoje: Ymd): { leitura: LeituraBoleto; beneficiario: string | null } | null {
  const candidatos = textoDoPdf.match(CANDIDATO_RE) ?? [];
  let primeiraValida: LeituraBoleto | null = null;

  for (const candidato of candidatos) {
    const digitos = candidato.replace(/\D/g, "");

    for (let ini = 0; ini <= 11 && ini + 47 <= digitos.length; ini++) {
      const leitura = lerLinhaDigitavel(digitos.slice(ini, ini + 47), hoje);
      if (!leitura) continue;
      if (leitura.vencimento) return { leitura, beneficiario: acharBeneficiario(textoDoPdf) };
      primeiraValida ??= leitura;
    }

    for (let ini = 0; ini <= 11 && ini + 48 <= digitos.length; ini++) {
      const janela = digitos.slice(ini, ini + 48);
      if (janela[0] !== "8") continue;
      const leitura = lerLinhaDigitavel(janela, hoje);
      if (leitura) primeiraValida ??= leitura;
    }
  }

  if (!primeiraValida) return null;
  return { leitura: primeiraValida, beneficiario: acharBeneficiario(textoDoPdf) };
}
