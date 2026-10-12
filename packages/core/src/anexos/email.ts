import type { Connection } from "@orbita/db/connector-schema";
import { baixarAnexoGmail, lerMensagemCompleta } from "../connectors/google";
import { baixarAnexoOutlook, lerMensagemCompletaOutlook } from "../connectors/microsoft";
import { rotuloDeExibicao } from "../connectors/identidade";
import { escolherConta } from "../connectors/multi";
import { tokensDeTodasAsContas } from "../connectors/store";
import { htmlParaTexto, linksDeDocumento } from "../arquivos/leitores/html";
import { embrulharDadoExterno } from "../texto/dado-externo";

/**
 * Um e-mail INTEIRO, de qualquer conta (PRD de anexos, C1).
 *
 * O modelo tem só o id que veio de `ler_emails` ou `outlook_ler_emails`, e o
 * dono pode ter três Gmails e um Outlook. A regra de `connectors/multi.ts`
 * (ler varre todas as contas) vale aqui também: a conta é achada procurando o
 * id, a mais provável primeiro (id do Gmail é hexadecimal curto; o do Outlook,
 * base64 longo). Quando o dono diz qual ("na do trabalho"), só aquela.
 */

export type Servico = "gmail" | "outlook";

export interface ContaDoEmail {
  servico: Servico;
  conexao: Connection;
  token: string;
  rotulo: string;
}

export interface AnexoInfo {
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  embutido: boolean;
  /** anexo que é link para documento no OneDrive/SharePoint (C6): listado, não baixado */
  link: string | null;
  /** é um link do Outlook (`referenceAttachment`), mesmo sem a URL: nunca é baixado (I15) */
  referencia?: boolean;
}

export interface EmailCompleto {
  id: string;
  servico: Servico;
  conta: string;
  conexaoId: string;
  de: string;
  para: string[];
  cc: string[];
  data: string;
  assunto: string;
  corpo: string;
  /** documentos compartilhados citados no corpo (Drive, OneDrive): listados, nunca baixados */
  links: string[];
  anexos: AnexoInfo[];
  abrir: string | null;
  /**
   * O `Authentication-Results` que o servidor de quem RECEBEU escreveu (o de cima;
   * os de baixo podem ter vindo do remetente). É dele que sai se o From é de
   * verdade, antes de tentar a senha cadastrada para aquele domínio (M13).
   */
  autenticacao: string;
}

export class EmailNaoEncontradoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailNaoEncontradoError";
  }
}

/** De qual serviço este id parece ser. PURO. */
export function servicoProvavel(id: string): Servico | null {
  if (/^[0-9a-f]{12,24}$/i.test(id)) return "gmail";
  if (id.length > 60 && /^[A-Za-z0-9+/=_-]+$/.test(id)) return "outlook";
  return null;
}

const PROVEDOR: Record<Servico, "google" | "microsoft"> = { gmail: "google", outlook: "microsoft" };

/** As contas em que vale procurar, a mais provável primeiro. */
export async function contasParaProcurar(userId: string, opts: { id?: string; servico?: Servico | null; conta?: string | null }): Promise<ContaDoEmail[]> {
  const provavel = opts.id ? servicoProvavel(opts.id) : null;
  const ordem: Servico[] = opts.servico ? [opts.servico] : provavel === "outlook" ? ["outlook", "gmail"] : ["gmail", "outlook"];
  const todas: ContaDoEmail[] = [];
  for (const servico of ordem) {
    const contas = await tokensDeTodasAsContas(PROVEDOR[servico], userId);
    contas.forEach(({ conexao, token }, i) => todas.push({ servico, conexao, token, rotulo: rotuloDeExibicao(conexao.accountLabel, i + 1) }));
  }
  if (!opts.conta?.trim()) return todas;
  const porConexao = todas.map((c) => ({ id: c.conexao.id, accountLabel: c.conexao.accountLabel, c }));
  const escolhida = escolherConta(porConexao, opts.conta) ?? porConexao.find((p) => p.c.rotulo.toLowerCase().includes(opts.conta!.trim().toLowerCase())) ?? null;
  if (!escolhida) throw new EmailNaoEncontradoError(`Não sei qual conta é "${opts.conta}". Contas: ${todas.map((c) => c.rotulo).join(", ") || "nenhuma"}.`);
  return [escolhida.c];
}

async function lerNaConta(c: ContaDoEmail, id: string): Promise<EmailCompleto> {
  if (c.servico === "gmail") {
    const m = await lerMensagemCompleta(c.token, id);
    const html = m.html ? htmlParaTexto(m.html) : null;
    const corpo = (m.textoPuro.trim() || html?.texto || "").trim();
    return {
      id: m.id, servico: "gmail", conta: c.rotulo, conexaoId: c.conexao.id, de: m.de, para: m.para, cc: m.cc, data: m.data, assunto: m.assunto || "(sem assunto)",
      corpo, links: linksDeDocumento(corpo, html?.links ?? []),
      anexos: m.anexos.map((a) => ({ ...a, link: null })),
      abrir: m.link,
      autenticacao: m.autenticacao ?? "",
    };
  }
  const m = await lerMensagemCompletaOutlook(c.token, id);
  const html = m.html ? htmlParaTexto(m.html) : null;
  const corpo = (m.textoPuro.trim() || html?.texto || "").trim();
  const linksDeAnexo = m.anexos.map((a) => a.link).filter((l): l is string => Boolean(l));
  return {
    id: m.id, servico: "outlook", conta: c.rotulo, conexaoId: c.conexao.id, de: m.de, para: m.para, cc: m.cc, data: m.data, assunto: m.assunto,
    corpo, links: [...new Set([...linksDeAnexo, ...linksDeDocumento(corpo, html?.links ?? [])])],
    anexos: m.anexos.map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho, embutido: a.embutido, link: a.link, ...(a.referencia ? { referencia: true } : {}) })),
    abrir: m.link,
    autenticacao: m.autenticacao ?? "",
  };
}

export type MotivoDaFalha = "nao_esta" | "acesso" | "limite" | "rede";

/**
 * Por que UMA conta não devolveu o e-mail. PURO.
 *
 * 400 e 404 são "o id não é desta conta" (o id do Gmail no Outlook dá 400).
 * 401 e 403 são o token vencido ou sem permissão, 429 é o limite de uso do
 * provedor, e o resto (rede, 5xx) é falha passageira. Antes tudo virava "não
 * achei", e o dono procurava um e-mail que estava lá (M3).
 */
export function motivoDaFalha(e: unknown): MotivoDaFalha {
  const m = /(?:Google API|Microsoft Graph) (\d{3})/.exec(e instanceof Error ? e.message : String(e));
  const status = m ? Number(m[1]) : 0;
  if (status === 400 || status === 404) return "nao_esta";
  if (status === 401 || status === 403) return "acesso";
  if (status === 429) return "limite";
  return "rede";
}

export class LeituraDoEmailFalhouError extends Error {
  constructor(message: string, readonly motivo: Exclude<MotivoDaFalha, "nao_esta">) {
    super(message);
    this.name = "LeituraDoEmailFalhouError";
  }
}

/** Lê o e-mail na primeira conta que o tem. "Não é desta conta" passa para a próxima; o resto é dito, não engolido. */
export async function lerEmail(userId: string, id: string, opts: { servico?: Servico | null; conta?: string | null } = {}): Promise<{ email: EmailCompleto; conta: ContaDoEmail }> {
  const contas = await contasParaProcurar(userId, { id, ...opts });
  if (!contas.length) throw new EmailNaoEncontradoError("Nenhuma conta de e-mail conectada (Gmail ou Outlook).");
  const falhas: { rotulo: string; motivo: Exclude<MotivoDaFalha, "nao_esta"> }[] = [];
  for (const c of contas) {
    try {
      return { email: await lerNaConta(c, id), conta: c };
    } catch (e) {
      const motivo = motivoDaFalha(e);
      if (motivo !== "nao_esta") falhas.push({ rotulo: c.rotulo, motivo });
    }
  }
  if (falhas.length) {
    const frase: Record<Exclude<MotivoDaFalha, "nao_esta">, string> = {
      acesso: "está com o acesso vencido ou sem permissão (reconecte em Conexões)",
      limite: "pediu para esperar (limite de uso do provedor); tente de novo em instantes",
      rede: "não respondeu agora (rede ou o provedor fora do ar); tente de novo em instantes",
    };
    const ditas = falhas.map((f) => `a conta ${f.rotulo} ${frase[f.motivo]}`).join("; ");
    throw new LeituraDoEmailFalhouError(`Não consegui procurar esse e-mail em todas as contas: ${ditas}.`, falhas[0]!.motivo);
  }
  throw new EmailNaoEncontradoError(`Não achei esse e-mail em nenhuma das ${contas.length} conta(s). Use o id que veio de ler_emails ou outlook_ler_emails.`);
}

/** A conta de uma leitura já feita, pela conexão (o trabalho em segundo plano e a execução aprovada usam isto). */
export async function contaDaConexao(userId: string, servico: Servico, conexaoId: string): Promise<ContaDoEmail> {
  const contas = await tokensDeTodasAsContas(PROVEDOR[servico], userId);
  const i = contas.findIndex((c) => c.conexao.id === conexaoId);
  if (i < 0) throw new EmailNaoEncontradoError("A conta deste e-mail foi desconectada.");
  return { servico, conexao: contas[i]!.conexao, token: contas[i]!.token, rotulo: rotuloDeExibicao(contas[i]!.conexao.accountLabel, i + 1) };
}

export async function baixarAnexo(c: ContaDoEmail, mensagemId: string, anexoId: string): Promise<Buffer> {
  return c.servico === "gmail" ? (await baixarAnexoGmail(c.token, mensagemId, anexoId)).bytes : (await baixarAnexoOutlook(c.token, mensagemId, anexoId)).bytes;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Qual anexo o dono quis dizer: o id, a posição ("o segundo", "2") ou um
 * pedaço do nome ("o contrato"). Dois casando é ambiguidade: devolve a lista
 * em vez de chutar. PURO.
 */
export function escolherAnexo(anexos: AnexoInfo[], pedido: string): AnexoInfo | { erro: string } {
  const p = pedido.trim();
  if (!anexos.length) return { erro: "Esse e-mail não tem anexo." };
  const porId = anexos.find((a) => a.id === p);
  if (porId) return porId;
  // a posição conta só os anexos de verdade: o logo embutido no corpo não é "o primeiro anexo" para ninguém
  const numerados = anexos.some((a) => !a.embutido) ? anexos.filter((a) => !a.embutido) : anexos;
  // os nomes vão como dado: a mensagem de erro também chega ao modelo, e o nome é de quem mandou (I2)
  const lista = embrulharDadoExterno("anexo", numerados.map((a, i) => `${i + 1}. ${a.nome}`).join("; "));
  if (/^\d{1,3}$/.test(p)) {
    const alvo = numerados[Number(p) - 1];
    return alvo ?? { erro: `O e-mail tem ${numerados.length} anexo(s): ${lista}` };
  }
  const alvo = semAcento(p);
  const exato = anexos.filter((a) => semAcento(a.nome) === alvo);
  if (exato.length === 1) return exato[0]!;
  const casa = anexos.filter((a) => semAcento(a.nome).includes(alvo));
  if (casa.length === 1) return casa[0]!;
  return { erro: casa.length > 1 ? `Mais de um anexo casa com "${pedido}". Diga qual: ${embrulharDadoExterno("anexo", casa.map((a) => a.nome).join(", "))}` : `Não achei o anexo "${pedido}". Anexos: ${lista}` };
}
