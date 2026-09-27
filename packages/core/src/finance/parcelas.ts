import { diaNoMes, mesDe, partes, somarMeses, type Ymd } from "./calendario";
import type { Centavos } from "./tipos";

export interface Parcela {
  n: number;
  de: number;
  valor: Centavos;
  data: Ymd;
  descricao: string;
}

/**
 * Divide um valor em N parcelas (PRD §5.18). O resto dos centavos vai para a
 * PRIMEIRA (100,00 em 3x = 33,34 + 33,33 + 33,33), e cada parcela seguinte cai
 * no mesmo dia dos meses seguintes, limitado ao último dia do mês. Com N > 1
 * a descrição ganha " (k/N)".
 */
export function dividirEmParcelas(total: Centavos, n: number, primeira: Ymd, descricao: string): Parcela[] {
  const qtd = Math.max(1, Math.floor(n));
  const base = Math.floor(total / qtd);
  const resto = total - base * qtd;
  const dia = partes(primeira).d;
  const mes = mesDe(primeira);
  return Array.from({ length: qtd }, (_, i) => ({
    n: i + 1,
    de: qtd,
    valor: base + (i === 0 ? resto : 0),
    data: i === 0 ? primeira : diaNoMes(somarMeses(mes, i), dia),
    descricao: qtd > 1 ? `${descricao} (${i + 1}/${qtd})` : descricao,
  }));
}
