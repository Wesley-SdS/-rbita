import type { Connection } from "@orbita/db/connector-schema";
import { rotuloDeExibicao } from "./identidade";
import { listarContas, tokenDaConexao, tokensDeTodasAsContas } from "./store";
import type { ConnectorId } from "./registry";

/**
 * Como uma tool se comporta quando o dono tem mais de uma conta no provedor.
 *
 * A regra vale para Google, Outlook, Jira e qualquer conector que venha depois:
 *
 *   LEITURA varre TODAS as contas e diz de qual veio cada item. "Tenho algum
 *   e-mail importante?" que só olhasse a conta principal seria pior do que não
 *   ter multi-conta, porque o dono confiaria numa resposta incompleta.
 *
 *   ESCRITA usa UMA conta. Mandar o e-mail pela conta errada é pior do que
 *   perguntar qual, então sem indicação vale a principal, e o resultado sempre
 *   diz por qual conta saiu.
 */

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Qual conta o dono quis dizer.
 *
 * O pedido chega como o modelo ouviu: "pela do trabalho", "no meu gmail",
 * "wesley@empresa.com". Casa por pedaço do rótulo, que é o que a pessoa fala.
 * Sem pedido, ou sem correspondência, devolve null e quem chama decide se cai
 * na principal ou se pergunta.
 */
export function escolherConta<T extends { id: string; accountLabel: string | null }>(contas: T[], pedido?: string | null): T | null {
  if (!pedido?.trim()) return null;
  const alvo = semAcento(pedido);

  // id exato primeiro: quando a tela manda o id, não há o que adivinhar
  const porId = contas.find((c) => c.id === pedido.trim());
  if (porId) return porId;

  const casa = contas.filter((c) => c.accountLabel && semAcento(c.accountLabel).includes(alvo));
  // duas contas casando é ambiguidade real: não escolher é mais honesto do que
  // chutar a primeira e mandar o e-mail pela conta errada
  return casa.length === 1 ? casa[0]! : null;
}

export interface ContaEscolhida {
  token: string;
  conexao: Connection;
  rotulo: string;
}

/**
 * A conta que vai EXECUTAR a escrita.
 *
 * Devolve `ambigua` quando o dono pediu algo que casa com mais de uma conta
 * (ou com nenhuma) tendo várias conectadas: aí a tool devolve a lista e deixa
 * ele escolher, em vez de arriscar.
 */
export async function contaParaEscrever(
  cid: ConnectorId,
  userId: string,
  pedido?: string | null,
): Promise<ContaEscolhida | { erro: string; contas?: string[] }> {
  const contas = await listarContas(userId, cid);
  if (contas.length === 0) return { erro: "Nenhuma conta conectada nesse serviço." };

  const rotulo = (c: Connection) => rotuloDeExibicao(c.accountLabel, contas.indexOf(c) + 1);

  if (pedido?.trim() && contas.length > 1) {
    const escolhida = escolherConta(contas, pedido);
    if (!escolhida) {
      return { erro: `Não sei por qual conta fazer isso. Diga qual.`, contas: contas.map(rotulo) };
    }
    return { token: await tokenDaConexao(escolhida), conexao: escolhida, rotulo: rotulo(escolhida) };
  }

  // sem pedido: a principal (é a primeira, por ordem do `listarContas`)
  const principal = contas[0]!;
  return { token: await tokenDaConexao(principal), conexao: principal, rotulo: rotulo(principal) };
}

/**
 * Roda a mesma leitura em todas as contas e junta, marcando a origem.
 *
 * Uma conta que falhe não derruba as outras: ela vira uma linha em `falhas`,
 * para a resposta poder dizer "vi 8 e-mails, mas a conta do trabalho não
 * respondeu" em vez de fingir que viu tudo.
 */
export async function lerDeTodasAsContas<T>(
  cid: ConnectorId,
  userId: string,
  ler: (token: string, conexao: Connection) => Promise<T[]>,
): Promise<{ itens: (T & { conta: string })[]; falhas: string[]; contas: number }> {
  const conexoes = await tokensDeTodasAsContas(cid, userId);
  const itens: (T & { conta: string })[] = [];
  const falhas: string[] = [];

  const resultados = await Promise.all(
    conexoes.map(async ({ conexao, token }, i) => {
      const rotulo = rotuloDeExibicao(conexao.accountLabel, i + 1);
      try {
        return { rotulo, lidos: await ler(token, conexao) };
      } catch {
        return { rotulo, lidos: null };
      }
    }),
  );

  for (const r of resultados) {
    if (r.lidos === null) falhas.push(r.rotulo);
    else for (const item of r.lidos) itens.push({ ...item, conta: r.rotulo });
  }
  return { itens, falhas, contas: conexoes.length };
}
