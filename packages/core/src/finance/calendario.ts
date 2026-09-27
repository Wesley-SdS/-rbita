/**
 * Datas do financeiro como TEXTO ("2026-09-08") e meses como "2026-09".
 *
 * Nada de `Date` para aritmética de mês: somar um mês a 31/01 com `setMonth`
 * cai em 03/03, e fuso horário empurra lançamento para o dia anterior (o
 * mesmo problema que `parseYmd` resolve na leitura de cupom). Aqui o dia é
 * sempre limitado ao último dia do mês, que é a regra do PRD (§5.18).
 */
export type Ymd = string;
export type Ym = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function partes(d: Ymd): { y: number; m: number; d: number } {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return { y: y!, m: m!, d: dd! };
}

export const mesDe = (d: Ymd): Ym => d.slice(0, 7);

export function diasNoMes(ym: Ym): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

export function somarMeses(ym: Ym, n: number): Ym {
  const [y, m] = ym.split("-").map(Number);
  const t = y! * 12 + (m! - 1) + n;
  return `${Math.floor(t / 12)}-${pad(((t % 12) + 12) % 12 + 1)}`;
}

/** O dia `dia` do mês, limitado ao último dia (31 vira 30, 28 ou 29). */
export function diaNoMes(ym: Ym, dia: number): Ymd {
  return `${ym}-${pad(Math.min(Math.max(1, dia), diasNoMes(ym)))}`;
}

const utc = (d: Ymd) => {
  const p = partes(d);
  return Date.UTC(p.y, p.m - 1, p.d);
};

export function somarDias(d: Ymd, n: number): Ymd {
  const t = new Date(utc(d) + n * 86_400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Quantos dias de `a` até `b` (negativo se `b` vem antes). */
export function diasEntre(a: Ymd, b: Ymd): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** "Hoje" no fuso local do processo, como texto. */
export function hojeLocal(agora = new Date()): Ymd {
  return `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
}
