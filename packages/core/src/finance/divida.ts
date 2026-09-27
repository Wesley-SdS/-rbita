import type { Centavos, Divida } from "./tipos";

export function saldoDevedor(d: Divida): Centavos {
  return Math.max(0, d.saldoInicial - d.pagamentos.reduce((s, p) => s + p.abatimento, 0));
}

export type Quitacao =
  | { tipo: "quitada" }
  | { tipo: "impossivel"; motivo: "sem_parcela" | "parcela_nao_cobre_juros" }
  | { tipo: "previsao"; meses: number; totalPago: Centavos; juros: Centavos };

/** Teto de segurança do laço: 50 anos. Acima disso, na prática, não acaba. */
const MESES_MAX = 600;

/**
 * Em quantos meses a dívida acaba (PRD §5.15). Mês a mês: soma os juros, paga
 * o menor entre a parcela e o devido. Se a parcela não cobre nem os juros, a
 * dívida só cresce, e dizer "quita em 600 meses" seria mentira: é impossível.
 */
export function projetarQuitacao(saldo: Centavos, jurosMesPct: number, parcela: Centavos): Quitacao {
  if (saldo <= 0) return { tipo: "quitada" };
  if (parcela <= 0) return { tipo: "impossivel", motivo: "sem_parcela" };
  const j = jurosMesPct / 100;
  let s = saldo;
  let pago = 0;
  for (let mes = 1; mes <= MESES_MAX; mes++) {
    const juros = s * j;
    const devido = s + juros;
    const pagamento = Math.min(parcela, devido);
    if (pagamento <= juros && pagamento < devido) return { tipo: "impossivel", motivo: "parcela_nao_cobre_juros" };
    pago += pagamento;
    s = devido - pagamento;
    if (s < 0.5) {
      const totalPago = Math.round(pago);
      return { tipo: "previsao", meses: mes, totalPago, juros: totalPago - saldo };
    }
  }
  return { tipo: "impossivel", motivo: "parcela_nao_cobre_juros" };
}

/** Separa um pagamento em juros do mês e abatimento do saldo. */
export function dividirPagamento(saldo: Centavos, jurosMesPct: number, valor: Centavos): { juros: Centavos; abatimento: Centavos } {
  const juros = Math.min(valor, Math.round(saldo * (jurosMesPct / 100)));
  return { juros, abatimento: Math.min(saldo, valor - juros) };
}
