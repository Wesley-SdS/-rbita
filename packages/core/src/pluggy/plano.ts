import { diasEntre, type Ymd } from "../finance/calendario";
import type { Centavos } from "../finance/tipos";
import type { TxBanco } from "./normalizar";
import { acharFaturaDoPagamento, type FaturaConhecida } from "./cartao";

/**
 * Decide o que cada transação nova do banco vira. Puro: o que lê e grava está
 * em `servico.ts`, o que decide está aqui, para as regras serem testadas sem
 * banco nem rede.
 *
 * O problema que isto resolve: mover dinheiro entre as próprias contas aparece
 * no banco como uma SAÍDA numa conta e uma ENTRADA na outra. Lançadas como
 * vieram, a saída conta como gasto e a entrada como renda, e o mês mente nos
 * dois sentidos. O motor já sabe o que é transferência (`transferencia` +
 * `grupoTransferencia`, que não contam como gasto nem como renda e continuam
 * mexendo no saldo de cada conta); falta RECONHECER o par.
 *
 * Três jeitos de reconhecer, do mais forte ao mais fraco:
 *  1. Já estava lançada à mão (mesma conta, valor e dia): `ja_existia`, não
 *     duplica, e a transferência que o dono lançou continua sendo dele.
 *  2. Par: uma saída e uma entrada de MESMO valor em contas diferentes do
 *     dono, com até N dias de distância. Um lado pode ter chegado numa leitura
 *     anterior (`soltas`): então só aquele lançamento antigo é reclassificado.
 *  3. Uma perna só: o banco informa que pagador e recebedor são o próprio
 *     titular (a outra conta não está sincronizada, ou é dinheiro vivo).
 *
 * Antes de tudo isso, o débito que paga uma FATURA de cartão sincronizado é
 * separado: ele é transferência (a compra já contou como gasto) e abate a
 * fatura, e nunca pode ser pareado com uma entrada qualquer de mesmo valor.
 *
 * Quando há um terceiro identificado do outro lado (a Maria, uma loja), a
 * linha NUNCA entra em par: pagar R$ 50 num Pix e receber R$ 50 de um amigo no
 * mesmo dia não é transferência, e tratá-la assim apagaria um gasto e uma renda.
 */

export interface LancamentoManual {
  id: string;
  natureza: "despesa" | "receita";
  data: Ymd;
  valor: Centavos;
  contaId: string | null;
}

/** Uma perna lançada numa leitura anterior que ainda não achou o par. */
export interface PernaSolta extends TxBanco {
  lancamentoId: string;
}

export type Decisao =
  | { tx: TxBanco; acao: "lancar" }
  | { tx: TxBanco; acao: "ja_existia"; lancamentoId: string }
  | { tx: TxBanco; acao: "transferencia_solta"; grupo: string }
  | { tx: TxBanco; acao: "pagamento_fatura"; fatura: FaturaConhecida }
  /** `par` é outra linha NOVA (as duas pernas nascem agora) ou uma `PernaSolta` (a antiga é reclassificada) */
  | { tx: TxBanco; acao: "transferencia"; grupo: string; par: TxBanco | PernaSolta };

export interface EntradaDoPlano {
  novas: TxBanco[];
  soltas: PernaSolta[];
  manuais: LancamentoManual[];
  /** `pluggy_conta.id` → conta da Órbita, para comparar com o que já foi lançado à mão */
  contaDe: Map<string, string | null>;
  /** dias de distância entre a saída e a entrada para valerem como um par */
  janelaDias: number;
  /** folga de data para considerar que um lançamento manual é a mesma linha do banco */
  diasRepetido: number;
  reconhecerTransferencias: boolean;
  /** a conta já tinha lançamentos antes da Pluggy (vinculada a uma existente): só aí compara com o que foi lançado à mão */
  compararComManuais: Set<string>;
  /** faturas dos cartões sincronizados, já na chave da Órbita; vazio = não procura pagamento de fatura */
  faturas?: FaturaConhecida[];
  novoGrupo: () => string;
}

const ehSolta = (t: TxBanco | PernaSolta): t is PernaSolta => "lancamentoId" in t;

export function planejar(e: EntradaDoPlano): Decisao[] {
  const decisoes = new Map<string, Decisao>();
  const porLinha = (t: TxBanco) => t.pluggyId;

  // 1. o que o dono já lançou à mão: cada lançamento manual casa com UMA linha só
  const livres = [...e.manuais];
  const restantes: TxBanco[] = [];
  for (const t of [...e.novas].sort(ordem)) {
    const contaId = e.contaDe.get(t.contaRef) ?? null;
    const i = contaId && e.compararComManuais.has(t.contaRef)
      ? livres.findIndex((m) => m.contaId === contaId && m.natureza === t.natureza && m.valor === t.valor && Math.abs(diasEntre(m.data, t.data)) <= e.diasRepetido)
      : -1;
    if (i >= 0) {
      decisoes.set(porLinha(t), { tx: t, acao: "ja_existia", lancamentoId: livres[i]!.id });
      livres.splice(i, 1);
    } else {
      restantes.push(t);
    }
  }

  // 1b. o débito que paga uma fatura de cartão sincronizado (cada fatura é paga uma vez por volta)
  const faturasLivres = [...(e.faturas ?? [])];
  const semFatura: TxBanco[] = [];
  for (const t of restantes) {
    const f = t.natureza === "despesa" && faturasLivres.length ? acharFaturaDoPagamento(t, faturasLivres) : null;
    if (f) {
      decisoes.set(porLinha(t), { tx: t, acao: "pagamento_fatura", fatura: f });
      faturasLivres.splice(faturasLivres.indexOf(f), 1);
    } else {
      semFatura.push(t);
    }
  }
  restantes.length = 0;
  restantes.push(...semFatura);

  // 2. pares: saída numa conta, entrada na outra
  const usadas = new Set<string>();
  if (e.reconhecerTransferencias) {
    const entradas: (TxBanco | PernaSolta)[] = [...restantes.filter((t) => t.natureza === "receita"), ...e.soltas.filter((t) => t.natureza === "receita")];
    const saidas: (TxBanco | PernaSolta)[] = [...restantes.filter((t) => t.natureza === "despesa"), ...e.soltas.filter((t) => t.natureza === "despesa")];
    for (const saida of saidas.sort(ordem)) {
      if (saida.terceiro || usadas.has(saida.pluggyId)) continue;
      const candidatas = entradas
        .filter((c) => !c.terceiro && !usadas.has(c.pluggyId) && c.contaRef !== saida.contaRef && c.valor === saida.valor)
        .filter((c) => !(ehSolta(saida) && ehSolta(c)))
        .filter((c) => Math.abs(diasEntre(saida.data, c.data)) <= e.janelaDias)
        .sort((a, b) => Math.abs(diasEntre(saida.data, a.data)) - Math.abs(diasEntre(saida.data, b.data)) || ordem(a, b));
      const entrada = candidatas[0];
      if (!entrada) continue;
      usadas.add(saida.pluggyId);
      usadas.add(entrada.pluggyId);
      const grupo = e.novoGrupo();
      if (!ehSolta(saida)) decisoes.set(porLinha(saida), { tx: saida, acao: "transferencia", grupo, par: entrada });
      if (!ehSolta(entrada)) decisoes.set(porLinha(entrada), { tx: entrada, acao: "transferencia", grupo, par: saida });
    }
  }

  // 3. uma perna só, quando o banco jura que os dois lados são o dono; o resto é lançamento comum
  const out: Decisao[] = [];
  for (const t of e.novas) {
    const ja = decisoes.get(porLinha(t));
    if (ja) out.push(ja);
    else if (e.reconhecerTransferencias && t.propria) out.push({ tx: t, acao: "transferencia_solta", grupo: e.novoGrupo() });
    else out.push({ tx: t, acao: "lancar" });
  }
  return out;
}

function ordem(a: TxBanco, b: TxBanco): number {
  return a.data < b.data ? -1 : a.data > b.data ? 1 : a.pluggyId < b.pluggyId ? -1 : a.pluggyId > b.pluggyId ? 1 : 0;
}

/**
 * Saldo inicial que faz o saldo da Órbita bater com o do banco: o saldo de hoje
 * menos o efeito de tudo que foi importado. Vale para a janela lida,
 * qualquer que seja o tamanho dela (o que ficou antes da janela está dentro do
 * saldo inicial).
 */
export function saldoInicialParaBater(saldoBanco: Centavos, importadas: { natureza: "despesa" | "receita"; valor: Centavos }[]): Centavos {
  const efeito = importadas.reduce((s, t) => s + (t.natureza === "receita" ? t.valor : -t.valor), 0);
  return saldoBanco - efeito;
}
