import { diaNoMes, mesDe, partes, somarMeses, type Ymd } from "./calendario";
import type { Compromisso } from "./tipos";

/** Teto de segurança por série: uma série parada há anos não vira laço sem fim. */
const ITERACOES_MAX = 48;

const mesmaConta = (a: Compromisso, b: Compromisso) =>
  a.direcao === b.direcao && a.descricao.trim().toLowerCase() === b.descricao.trim().toLowerCase();

/**
 * Conta fixa sempre existe em aberto até N meses à frente (PRD §4.4), quite
 * o dono as anteriores ou não. Devolve só as ocorrências NOVAS; quem grava é
 * o store. Não cria se o mês já tem a mesma série, ou uma conta de mesma
 * direção e descrição (o dono pode ter lançado à mão).
 */
export function semearRecorrentes(cs: Compromisso[], hoje: Ymd, mesesAFrente: number, novoId: () => string): Compromisso[] {
  const limite = somarMeses(mesDe(hoje), mesesAFrente);
  const todos = [...cs];
  const novos: Compromisso[] = [];
  const series = new Map<string, Compromisso[]>();
  for (const c of cs) if (c.recorrencia === "mensal") series.set(c.serieId ?? c.id, [...(series.get(c.serieId ?? c.id) ?? []), c]);

  for (const [serieId, ocorr] of series) {
    let ultima = ocorr.reduce((a, b) => (b.vencimento > a.vencimento ? b : a));
    // o dia da série é o da ocorrência mais antiga (§4.3 passo 5)
    const primeira = ocorr.reduce((a, b) => (b.vencimento < a.vencimento ? b : a));
    const dia = primeira.diaMes ?? partes(primeira.vencimento).d;
    let mes = mesDe(ultima.vencimento);
    for (let i = 0; i < ITERACOES_MAX && mes < limite; i++) {
      mes = somarMeses(mes, 1);
      const existe = todos.some((c) => mesDe(c.vencimento) === mes && ((c.serieId ?? c.id) === serieId || mesmaConta(c, ultima)));
      if (existe) continue;
      const nova: Compromisso = {
        id: novoId(),
        direcao: ultima.direcao,
        descricao: ultima.descricao,
        valor: ultima.valor,
        vencimento: diaNoMes(mes, dia),
        recorrencia: "mensal",
        serieId,
        diaMes: dia,
        status: "aberto",
        categoriaId: ultima.categoriaId ?? null,
        contaId: ultima.contaId ?? null,
      };
      novos.push(nova);
      todos.push(nova);
      ultima = nova;
    }
  }
  return novos;
}

export interface EdicaoDeSerie {
  descricao: string;
  valor: number;
  categoriaId?: string | null;
  contaId?: string | null;
  diaMes: number;
}

/**
 * Editar uma ocorrência de conta fixa propaga para as POSTERIORES em aberto
 * da mesma série (§4.5). Quitadas e anteriores são história: não mudam.
 * Devolve as ocorrências alteradas.
 */
export function propagarEdicao(cs: Compromisso[], editada: Compromisso, ed: EdicaoDeSerie): Compromisso[] {
  const serie = editada.serieId ?? editada.id;
  return cs
    .filter((c) => c.id !== editada.id && (c.serieId ?? c.id) === serie && c.status === "aberto" && c.vencimento > editada.vencimento)
    .map((c) => ({
      ...c,
      descricao: ed.descricao,
      valor: ed.valor,
      categoriaId: ed.categoriaId ?? null,
      contaId: ed.contaId ?? null,
      diaMes: ed.diaMes,
      vencimento: diaNoMes(mesDe(c.vencimento), ed.diaMes),
    }));
}
