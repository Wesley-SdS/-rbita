import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db } from "@orbita/db";
import { finLancamento } from "@orbita/db/finance-schema";
import { pluggyTransacao } from "@orbita/db/pluggy-schema";
import { diasEntre, somarDias, type Ymd } from "./calendario";
import type { Centavos } from "./tipos";
import { settings } from "../settings";

/**
 * Transferências entre as suas contas que já estavam lançadas como saída numa
 * conta e entrada na outra (extrato importado, lançamento por voz). Elas inflam
 * o gasto e a renda do mês do mesmo jeito que as do banco.
 *
 * NUNCA é automático: sem o documento do outro lado (o que o Open Finance
 * informa), "saí R$ 500 de uma conta e entrou R$ 500 em outra no mesmo dia"
 * também descreve pagar um amigo que lhe devolve o valor. Então a Órbita só
 * SUGERE o par, e quem decide é o dono (tela, chat ou voz), um a um ou todos.
 */

export interface LancamentoDeConta {
  id: string;
  tipo: "despesa" | "receita";
  data: Ymd;
  valor: Centavos;
  descricao: string | null;
  contaId: string;
}

export interface ParSugerido {
  saida: LancamentoDeConta;
  entrada: LancamentoDeConta;
  /** distância em dias entre as duas pernas */
  dias: number;
}

/** Os pares possíveis, do mais certo (mesmo dia) ao menos. Cada lançamento entra em no máximo um par. Puro. */
export function sugerirPares(ls: LancamentoDeConta[], janelaDias: number, excluir: ReadonlySet<string> = new Set()): ParSugerido[] {
  const ordem = (a: LancamentoDeConta, b: LancamentoDeConta) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const saidas = ls.filter((l) => l.tipo === "despesa" && !excluir.has(l.id)).sort(ordem);
  const entradas = ls.filter((l) => l.tipo === "receita" && !excluir.has(l.id)).sort(ordem);
  const usadas = new Set<string>();
  const out: ParSugerido[] = [];
  // primeiro os pares do mesmo dia, depois os de 1 dia, e assim por diante: o par mais certo escolhe primeiro
  for (let folga = 0; folga <= janelaDias; folga++) {
    for (const saida of saidas) {
      if (usadas.has(saida.id)) continue;
      const entrada = entradas.find((e) => !usadas.has(e.id) && e.contaId !== saida.contaId && e.valor === saida.valor && Math.abs(diasEntre(saida.data, e.data)) === folga);
      if (!entrada) continue;
      usadas.add(saida.id);
      usadas.add(entrada.id);
      out.push({ saida, entrada, dias: folga });
    }
  }
  return out.sort((a, b) => (a.saida.data < b.saida.data ? 1 : a.saida.data > b.saida.data ? -1 : 0));
}

/**
 * Os pares sugeridos do dono. Só entra lançamento comum de conta: o que já é
 * transferência, o que é de cartão, conta fixa quitada, projeto e estorno ficam
 * de fora, e o que o banco disse ter um terceiro do outro lado também.
 */
export async function paresSugeridosDoDono(userId: string, hoje: Ymd, meses = 12): Promise<ParSugerido[]> {
  const janela = await settings.get("pluggy.janelaTransferenciaDias");
  const rows = await db
    .select({ id: finLancamento.id, tipo: finLancamento.tipo, data: finLancamento.data, valor: finLancamento.valor, descricao: finLancamento.descricao, contaId: finLancamento.contaId })
    .from(finLancamento)
    .where(and(
      eq(finLancamento.userId, userId),
      eq(finLancamento.transferencia, false),
      eq(finLancamento.fixo, false),
      eq(finLancamento.estorno, false),
      isNull(finLancamento.cartaoId),
      isNull(finLancamento.metaId),
      isNull(finLancamento.compromissoId),
      isNotNull(finLancamento.contaId),
      gte(finLancamento.data, somarDias(hoje, -30 * meses)),
    ));
  const terceiros = await db
    .select({ id: pluggyTransacao.lancamentoId })
    .from(pluggyTransacao)
    .where(and(eq(pluggyTransacao.userId, userId), eq(pluggyTransacao.terceiro, true), isNotNull(pluggyTransacao.lancamentoId)));
  const excluir = new Set(terceiros.map((t) => t.id!));
  return sugerirPares(rows.map((r) => ({ ...r, contaId: r.contaId! })), janela, excluir);
}
