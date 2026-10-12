import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { finConta, finCartao, finLancamento, finCategoria, finRegra, finPagamentoFatura } from "@orbita/db/finance-schema";
import { pluggyItem, pluggyConta, pluggyTransacao, type PluggyConta } from "@orbita/db/pluggy-schema";
import { decryptSecret } from "../crypto";
import { listarContas } from "../connectors/store";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { somarDias, type Ymd } from "../finance/calendario";
import { CATEGORIA_SISTEMA, corDaVez } from "../finance/padroes";
import { palpitarCategoria } from "../finance/palpite";
import { categoriaDoSistema, garantirInicio, hojeDoServidor, inserirLancamentos } from "../finance/store";
import type { NovoLancamento } from "../finance/operacoes";
import { brl } from "../finance/formato";
import type { Cartao } from "../finance/tipos";
import { criarConnectToken, lerContas, lerFaturas, lerItem, lerTransacoes, saldoEmCentavos, PluggyErro, type Credenciais, type FaturaPluggy } from "./cliente";
import { normalizarTransacao, soDigitos, type TxBanco } from "./normalizar";
import { dataNaFaturaDoBanco, fechamentoDaFatura, normalizarCompraDoCartao, pareceDebitoDeFatura, type FaturaConhecida, type TxCartao } from "./cartao";
import { planejar, saldoInicialParaBater, type Decisao, type LancamentoManual, type PernaSolta } from "./plano";

/**
 * A sincronização com a Pluggy. Duas fases, de propósito:
 *
 *  1. REDE: lê itens, contas, faturas e transações da Pluggy para a memória.
 *     Nenhuma transação de banco fica aberta enquanto se espera a rede.
 *  2. GRAVAÇÃO: uma transação só, sob trava por dono, que decide (`plano.ts`) e
 *     grava. Se cair no meio, nada foi gravado, e a leitura seguinte refaz o
 *     mesmo trabalho: a trava contra duplicar é o id da transação na Pluggy
 *     (`pluggy_transacao`), que entra na mesma transação do lançamento.
 */

/** Erro que é do DONO (item inválido, falta conectar): vira mensagem na tela. */
export class AvisoPluggy extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvisoPluggy";
  }
}

export interface ResumoDaSincronizacao {
  itens: number;
  contas: number;
  lancadas: number;
  transferencias: number;
  /** pagamentos de fatura de cartão reconhecidos na conta corrente */
  faturasPagas: number;
  jaExistiam: number;
  avisos: string[];
}

export interface OpcoesDaSincronizacao {
  progresso?: (feito: number, total: number | null, passo?: string) => Promise<void> | void;
  /** a volta de rotina avisa o dono do que entrou; "sincronizar agora" e a primeira leitura não */
  notificar?: boolean;
}

const ID_DE_ITEM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEM_CREDENCIAL = "Conecte a Pluggy primeiro, em Conexões, com o Client ID e o Client Secret.";

// ── credenciais ─────────────────────────────────────────────────────────────

export async function credenciaisDoDono(userId: string): Promise<Credenciais | null> {
  for (const c of await listarContas(userId, "pluggy")) {
    try {
      const o = JSON.parse(decryptSecret(c.accessTokenEnc)) as Partial<Credenciais>;
      if (o.clientId && o.clientSecret) return { clientId: o.clientId, clientSecret: o.clientSecret };
    } catch {
      /* credencial ilegível: tenta a próxima */
    }
  }
  return credenciaisDoAmbiente(userId);
}

/**
 * As credenciais pelo `.env` (`PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`), pedido
 * do dono em 12/10/2026, como alternativa a colar em Conexões. Valem SÓ para o
 * dono da instância: o `.env` é da casa, e o banco dele não pode aparecer na conta
 * de outra pessoa da casa. A conexão salva pela tela, quando existe, vem antes.
 */
async function credenciaisDoAmbiente(userId: string): Promise<Credenciais | null> {
  const clientId = process.env.PLUGGY_CLIENT_ID?.trim();
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const { getOwnerId } = await import("../owner");
  return (await getOwnerId()) === userId ? { clientId, clientSecret } : null;
}

/** Os Item IDs do `.env` (`PLUGGY_ITEM_IDS`, separados por vírgula): o banco que o dono conectou na Pluggy. */
export function itensDoAmbiente(valor = process.env.PLUGGY_ITEM_IDS ?? ""): string[] {
  return [...new Set(valor.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((id) => ID_DE_ITEM.test(id)))];
}

export async function donosComPluggy(): Promise<string[]> {
  const { usersConnected } = await import("../connectors/store");
  const donos = new Set(await usersConnected("pluggy"));
  if (process.env.PLUGGY_CLIENT_ID?.trim() && process.env.PLUGGY_CLIENT_SECRET?.trim()) {
    const { getOwnerId } = await import("../owner");
    const dono = await getOwnerId();
    if (dono) donos.add(dono);
  }
  return [...donos];
}

// ── itens e contas ──────────────────────────────────────────────────────────

const nomeDaConta = (banco: string, c: { name?: string | null; marketingName?: string | null }) => {
  const base = (c.marketingName || c.name || "Conta").trim();
  return base.toLowerCase().includes(banco.toLowerCase()) ? base : `${banco} · ${base}`;
};

const diaDoMes = (iso?: string | null): number | null => {
  const d = Number(/^\d{4}-\d{2}-(\d{2})/.exec(iso ?? "")?.[1]);
  return d >= 1 && d <= 31 ? d : null;
};

/** Em português, o que o status do item pede do dono. */
export function avisoDoStatus(status?: string | null, execucao?: string | null): string | null {
  if (status === "LOGIN_ERROR" || execucao === "INVALID_CREDENTIALS") return "O banco recusou o acesso. Renove a conexão deste banco.";
  if (status === "WAITING_USER_INPUT" || status === "WAITING_USER_ACTION" || execucao === "USER_INPUT_TIMEOUT") return "O banco está esperando uma confirmação sua (código ou aprovação no aplicativo).";
  if (status === "OUTDATED") return "Os dados deste banco estão desatualizados na Pluggy. Renove a conexão.";
  if (execucao === "SITE_NOT_AVAILABLE" || execucao === "CONNECTION_ERROR") return "O banco está fora do ar para a Pluggy. Tentamos de novo na próxima volta.";
  return null;
}

/** O banco fora do ar passa sozinho; os outros pedem uma ação do dono, e só esses valem um aviso. */
const PEDE_ACAO = (status?: string | null, execucao?: string | null) => !!avisoDoStatus(status, execucao) && execucao !== "SITE_NOT_AVAILABLE" && execucao !== "CONNECTION_ERROR";

/** Atualiza o item e as contas dele a partir da Pluggy. Não lê transação. */
async function atualizarItem(userId: string, cred: Credenciais, linha: { id: string; itemId: string; avisoStatus?: string | null }, notificar = false): Promise<{ banco: string; contas: number }> {
  const [item, contas] = await Promise.all([lerItem(cred, linha.itemId), lerContas(cred, linha.itemId)]);
  const banco = item.connector?.name?.trim() || "Banco";
  const pedeAcao = PEDE_ACAO(item.status, item.executionStatus);
  await db
    .update(pluggyItem)
    .set({
      banco,
      status: item.status ?? null,
      executionStatus: item.executionStatus ?? null,
      atualizadoNoBancoEm: item.lastUpdatedAt ? new Date(item.lastUpdatedAt) : null,
      erro: null,
      // saudável de novo: o próximo problema volta a valer um aviso
      ...(pedeAcao ? {} : { avisoStatus: null }),
    })
    .where(and(eq(pluggyItem.id, linha.id), eq(pluggyItem.userId, userId)));

  // UM aviso por problema, não um por volta: o status guardado é o que já foi dito ao dono
  if (notificar && pedeAcao && item.status && linha.avisoStatus !== item.status) {
    await db.update(pluggyItem).set({ avisoStatus: item.status }).where(eq(pluggyItem.id, linha.id));
    const { notifyUser } = await import("../routines/run");
    await notifyUser(userId, `${banco} precisa de você`, avisoDoStatus(item.status, item.executionStatus)!, null, { destino: "/app/financas", origem: "sistema" }).catch(() => undefined);
  }

  for (const c of contas) {
    const tipo = c.type === "CREDIT" ? "CREDIT" : "BANK";
    const valores = {
      subtipo: c.subtype ?? null,
      nome: nomeDaConta(banco, c),
      numero: c.number ?? null,
      titularDocumento: soDigitos(c.taxNumber) || null,
      saldoBanco: tipo === "BANK" ? saldoEmCentavos(c.balance) : null,
      saldoBancoEm: new Date(),
      limite: tipo === "CREDIT" ? saldoEmCentavos(c.creditData?.creditLimit) : null,
      diaFechamento: tipo === "CREDIT" ? diaDoMes(c.creditData?.balanceCloseDate) : null,
      diaVencimento: tipo === "CREDIT" ? diaDoMes(c.creditData?.balanceDueDate) : null,
    };
    await db
      .insert(pluggyConta)
      // só lê depois que o dono vincular; conta e cartão são ligados do mesmo jeito
      .values({ userId, itemRef: linha.id, pluggyId: c.id, tipo, ativa: true, ...valores })
      .onConflictDoUpdate({
        target: [pluggyConta.userId, pluggyConta.pluggyId],
        // dia de fechar/vencer que a Pluggy deixou de informar não apaga o que já se sabia
        set: { ...valores, limite: sql`coalesce(excluded.limite, ${pluggyConta.limite})`, diaFechamento: sql`coalesce(excluded.dia_fechamento, ${pluggyConta.diaFechamento})`, diaVencimento: sql`coalesce(excluded.dia_vencimento, ${pluggyConta.diaVencimento})` },
      });
  }
  return { banco, contas: contas.length };
}

/** O dono cola o Item ID (ou o widget devolve). A conta só começa a sincronizar depois de vinculada. */
export async function adicionarItem(userId: string, itemIdBruto: string): Promise<{ banco: string; contas: number }> {
  const itemId = itemIdBruto.trim().toLowerCase();
  if (!ID_DE_ITEM.test(itemId)) throw new AvisoPluggy("O Item ID da Pluggy é um código no formato 00000000-0000-0000-0000-000000000000.");
  const cred = await credenciaisDoDono(userId);
  if (!cred) throw new AvisoPluggy(SEM_CREDENCIAL);
  const [linha] = await db
    .insert(pluggyItem)
    .values({ userId, itemId })
    .onConflictDoUpdate({ target: [pluggyItem.userId, pluggyItem.itemId], set: { erro: null } })
    .returning({ id: pluggyItem.id, itemId: pluggyItem.itemId, avisoStatus: pluggyItem.avisoStatus });
  try {
    return await atualizarItem(userId, cred, linha!);
  } catch (e) {
    // item que a Pluggy não conhece nesta aplicação não fica como uma linha morta na tela
    const novo = await db.select({ n: sql<number>`count(*)` }).from(pluggyConta).where(eq(pluggyConta.itemRef, linha!.id));
    if (!Number(novo[0]?.n)) await db.delete(pluggyItem).where(eq(pluggyItem.id, linha!.id));
    if (e instanceof PluggyErro && e.status === 404) throw new AvisoPluggy("A Pluggy não achou esse item na sua aplicação. Confira se o Item ID é de uma conexão feita com este Client ID.");
    throw e;
  }
}

export async function removerItem(userId: string, id: string): Promise<boolean> {
  const r = await db.delete(pluggyItem).where(and(eq(pluggyItem.id, id), eq(pluggyItem.userId, userId))).returning({ id: pluggyItem.id });
  return r.length > 0;
}

/**
 * O token que o widget de conexão usa no navegador (nunca o clientSecret). Com
 * `id` de um item já acompanhado, o widget abre para RENOVAR aquela conexão
 * (refazer o login ou o consentimento que venceu).
 */
export async function tokenDeConexao(userId: string, id?: string | null): Promise<{ accessToken: string; itemId: string | null }> {
  const cred = await credenciaisDoDono(userId);
  if (!cred) throw new AvisoPluggy(SEM_CREDENCIAL);
  let itemId: string | null = null;
  if (id) {
    const [item] = await db.select({ itemId: pluggyItem.itemId }).from(pluggyItem).where(and(eq(pluggyItem.id, id), eq(pluggyItem.userId, userId)));
    if (!item) throw new AvisoPluggy("Banco não encontrado.");
    itemId = item.itemId;
  }
  // a Pluggy guarda esse identificador em cada conexão: um derivado, e não o id interno da conta
  const clientUserId = createHash("sha256").update(`orbita:${userId}`).digest("hex").slice(0, 24);
  const accessToken = await criarConnectToken(cred, { ...(itemId ? { itemId } : {}), clientUserId });
  return { accessToken, itemId };
}

export type DestinoDaConta = { contaId: string } | { cartaoId: string } | { nova: true };

/**
 * Liga uma conta ou cartão do banco a uma conta ou cartão da Órbita: um que já
 * existe (os lançamentos de hoje continuam e a Pluggy só acrescenta o que
 * faltar) ou um novo. Conta nova nasce vazia, e o saldo inicial é acertado para
 * bater com o do banco. Cartão novo só é criado com o fechamento e o
 * vencimento que a Pluggy informou: a Órbita não inventa esses dias.
 */
export async function vincularConta(userId: string, pluggyContaId: string, destino: DestinoDaConta): Promise<{ contaId: string | null; cartaoId: string | null }> {
  // quem conecta o banco antes de abrir as Finanças ainda não tem contas nem categorias
  await garantirInicio(userId);
  return db.transaction(async (tx) => {
    const [pc] = await tx.select().from(pluggyConta).where(and(eq(pluggyConta.id, pluggyContaId), eq(pluggyConta.userId, userId)));
    if (!pc) throw new AvisoPluggy("Conta do banco não encontrada.");
    let contaId: string | null = null;
    let cartaoId: string | null = null;

    if (pc.tipo === "BANK") {
      if ("cartaoId" in destino) throw new AvisoPluggy("Uma conta corrente é ligada a uma conta, não a um cartão.");
      if ("contaId" in destino) {
        const [c] = await tx.select({ id: finConta.id }).from(finConta).where(and(eq(finConta.id, destino.contaId), eq(finConta.userId, userId)));
        if (!c) throw new AvisoPluggy("Conta não encontrada.");
        const [ocupada] = await tx.select({ id: pluggyConta.id }).from(pluggyConta).where(and(eq(pluggyConta.userId, userId), eq(pluggyConta.contaId, c.id)));
        if (ocupada && ocupada.id !== pc.id) throw new AvisoPluggy("Esta conta já recebe o extrato de outra conta do banco.");
        contaId = c.id;
      } else {
        const existentes = await tx.select({ id: finConta.id }).from(finConta).where(eq(finConta.userId, userId));
        const [c] = await tx.insert(finConta).values({ userId, nome: pc.nome.slice(0, 120), tipo: "corrente", saldoInicial: 0, cor: corDaVez(existentes.length), ordem: existentes.length }).returning({ id: finConta.id });
        contaId = c!.id;
      }
    } else {
      if ("contaId" in destino) throw new AvisoPluggy("Um cartão é ligado a um cartão, não a uma conta.");
      if ("cartaoId" in destino) {
        const [c] = await tx.select({ id: finCartao.id }).from(finCartao).where(and(eq(finCartao.id, destino.cartaoId), eq(finCartao.userId, userId)));
        if (!c) throw new AvisoPluggy("Cartão não encontrado.");
        const [ocupado] = await tx.select({ id: pluggyConta.id }).from(pluggyConta).where(and(eq(pluggyConta.userId, userId), eq(pluggyConta.cartaoId, c.id)));
        if (ocupado && ocupado.id !== pc.id) throw new AvisoPluggy("Este cartão já recebe as compras de outro cartão do banco.");
        cartaoId = c.id;
      } else {
        if (!pc.diaFechamento || !pc.diaVencimento) {
          throw new AvisoPluggy("A Pluggy não informou o fechamento e o vencimento deste cartão. Cadastre o cartão em Finanças (aba Cartões) e escolha-o aqui.");
        }
        const existentes = await tx.select({ id: finCartao.id }).from(finCartao).where(eq(finCartao.userId, userId));
        const [c] = await tx
          .insert(finCartao)
          .values({ userId, nome: pc.nome.slice(0, 120), limite: pc.limite ?? 0, fechamento: pc.diaFechamento, vencimento: pc.diaVencimento, cor: corDaVez(existentes.length), ordem: existentes.length })
          .returning({ id: finCartao.id });
        cartaoId = c!.id;
      }
    }

    // trocar o destino recomeça a primeira leitura: o que já foi lido não se aplica ao destino novo
    const mudou = pc.contaId !== contaId || pc.cartaoId !== cartaoId;
    await tx.update(pluggyConta).set({ contaId, cartaoId, ativa: true, ...(mudou ? { importadaEm: null } : {}) }).where(eq(pluggyConta.id, pc.id));
    if (mudou) await tx.delete(pluggyTransacao).where(and(eq(pluggyTransacao.userId, userId), eq(pluggyTransacao.contaRef, pc.id)));
    return { contaId, cartaoId };
  });
}

export async function ativarConta(userId: string, pluggyContaId: string, ativa: boolean): Promise<boolean> {
  const r = await db.update(pluggyConta).set({ ativa }).where(and(eq(pluggyConta.id, pluggyContaId), eq(pluggyConta.userId, userId))).returning({ id: pluggyConta.id });
  return r.length > 0;
}

/**
 * Faz o saldo da conta da Órbita bater com o do banco mexendo SÓ no saldo
 * inicial (nenhum lançamento é criado nem apagado). É para a conta que já tinha
 * lançamentos antes da Pluggy, onde a Órbita não acerta o saldo sozinha porque
 * não sabe qual dos dois lados está certo; quem decide é o dono, ao pedir.
 */
export async function acertarSaldoInicial(userId: string, pluggyContaId: string): Promise<{ saldoInicial: number }> {
  const [pc] = await db.select().from(pluggyConta).where(and(eq(pluggyConta.id, pluggyContaId), eq(pluggyConta.userId, userId)));
  if (!pc?.contaId) throw new AvisoPluggy("Esta conta do banco ainda não está ligada a uma conta da Órbita.");
  if (pc.saldoBanco === null) throw new AvisoPluggy("A Pluggy não informou o saldo desta conta.");
  const [r] = await db
    .select({ efeito: sql<string>`coalesce(sum(case when ${finLancamento.tipo} = 'receita' then ${finLancamento.valor} else -${finLancamento.valor} end), 0)` })
    .from(finLancamento)
    .where(and(eq(finLancamento.userId, userId), eq(finLancamento.contaId, pc.contaId), isNull(finLancamento.cartaoId), lte(finLancamento.data, hojeDoServidor())));
  const saldoInicial = pc.saldoBanco - Number(r?.efeito ?? 0);
  const atualizada = await db.update(finConta).set({ saldoInicial }).where(and(eq(finConta.id, pc.contaId), eq(finConta.userId, userId))).returning({ id: finConta.id });
  if (!atualizada.length) throw new AvisoPluggy("A conta da Órbita não existe mais.");
  return { saldoInicial };
}

// ── sincronização ───────────────────────────────────────────────────────────

/** Uma sincronização por dono de cada vez: o laço e o botão "sincronizar agora" não rodam juntos. */
const emAndamento = new Map<string, Promise<ResumoDaSincronizacao>>();

export function sincronizarDono(userId: string, opcoes: OpcoesDaSincronizacao = {}): Promise<ResumoDaSincronizacao> {
  const rodando = emAndamento.get(userId);
  if (rodando) return rodando;
  const p = sincronizar(userId, opcoes).finally(() => emAndamento.delete(userId));
  emAndamento.set(userId, p);
  return p;
}

interface Coletado {
  conta: PluggyConta;
  txs: TxBanco[];
  faturas: FaturaPluggy[];
}

async function sincronizar(userId: string, { progresso, notificar = false }: OpcoesDaSincronizacao): Promise<ResumoDaSincronizacao> {
  const resumo: ResumoDaSincronizacao = { itens: 0, contas: 0, lancadas: 0, transferencias: 0, faturasPagas: 0, jaExistiam: 0, avisos: [] };
  const cred = await credenciaisDoDono(userId);
  if (!cred) throw new AvisoPluggy(SEM_CREDENCIAL);
  await garantirInicio(userId);
  const [diasIniciais, diasRevisao] = await Promise.all([settings.get("pluggy.diasIniciais"), settings.get("pluggy.diasRevisao")]);
  const hoje = hojeDoServidor();

  // o banco listado no `.env` passa a ser acompanhado sem precisar colar o Item ID na tela
  const doAmbiente = itensDoAmbiente();
  if (doAmbiente.length && (await credenciaisDoAmbiente(userId))) {
    const conhecidos = new Set((await db.select({ itemId: pluggyItem.itemId }).from(pluggyItem).where(eq(pluggyItem.userId, userId))).map((i) => i.itemId));
    for (const itemId of doAmbiente.filter((i) => !conhecidos.has(i))) {
      await adicionarItem(userId, itemId).catch((e) => resumo.avisos.push(`Item ${itemId.slice(0, 8)} do .env: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  const itens = await db.select().from(pluggyItem).where(eq(pluggyItem.userId, userId));
  resumo.itens = itens.length;
  if (!itens.length) return resumo;

  // 1. rede
  const coletado: Coletado[] = [];
  let feito = 0;
  for (const item of itens) {
    await progresso?.(feito++, itens.length, `lendo ${item.banco}`);
    try {
      await atualizarItem(userId, cred, item, notificar);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resumo.avisos.push(`${item.banco}: ${msg}`);
      await db.update(pluggyItem).set({ erro: msg.slice(0, 300) }).where(eq(pluggyItem.id, item.id));
      continue;
    }
    const contas = await db.select().from(pluggyConta).where(and(eq(pluggyConta.itemRef, item.id), eq(pluggyConta.userId, userId)));
    for (const conta of contas) {
      if (!conta.ativa) continue;
      const destino = conta.tipo === "BANK" ? conta.contaId : conta.cartaoId;
      if (!destino) {
        // cartão ainda sem vínculo não é pendência de quem só usa conta corrente
        if (conta.tipo === "BANK") resumo.avisos.push(`${conta.nome}: escolha em qual conta da Órbita lançar o extrato.`);
        continue;
      }
      const [ultima] = await db.select({ d: sql<string | null>`max(${pluggyTransacao.data})` }).from(pluggyTransacao).where(eq(pluggyTransacao.contaRef, conta.id));
      const desde: Ymd = ultima?.d ? somarDias(ultima.d, -diasRevisao) : somarDias(hoje, -diasIniciais);
      try {
        const brutas = await lerTransacoes(cred, conta.pluggyId, desde);
        const txs = brutas
          .map((b) => (conta.tipo === "BANK" ? normalizarTransacao(b, conta.id, conta.titularDocumento) : normalizarCompraDoCartao(b, conta.id)))
          .filter((t): t is TxBanco => !!t);
        // a fatura que o banco emitiu decide em que mês a compra pesa; cartão sem fatura legível segue com a data da compra
        const faturas = conta.tipo === "CREDIT" ? await lerFaturas(cred, conta.pluggyId).catch(() => []) : [];
        coletado.push({ conta, txs, faturas });
      } catch (e) {
        resumo.avisos.push(`${conta.nome}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  resumo.contas = coletado.length;

  // 2. gravação
  await progresso?.(feito, itens.length, "gravando os lançamentos");
  const gravado = await db.transaction((tx) => gravar(tx, userId, coletado));
  resumo.lancadas = gravado.lancadas;
  resumo.transferencias = gravado.transferencias;
  resumo.faturasPagas = gravado.faturasPagas;
  resumo.jaExistiam = gravado.jaExistiam;
  resumo.avisos.push(...gravado.avisos);
  const agora = new Date();
  for (const item of itens) {
    if (!resumo.avisos.some((a) => a.startsWith(`${item.banco}:`))) await db.update(pluggyItem).set({ sincronizadoEm: agora }).where(eq(pluggyItem.id, item.id));
  }
  log.info("pluggy.sincronizado", { ...resumo, avisos: resumo.avisos.length });
  if (notificar) await avisarNovidades(userId, resumo);
  return resumo;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "Bancos sincronizados: 3 lançamentos novos e 1 transferência entre suas contas." Só quando entrou algo, e só se o dono quiser. */
async function avisarNovidades(userId: string, r: ResumoDaSincronizacao): Promise<void> {
  if (!r.lancadas && !r.transferencias && !r.faturasPagas) return;
  if (!(await settings.get("pluggy.avisar"))) return;
  const partes = [
    r.lancadas ? plural(r.lancadas, "lançamento novo", "lançamentos novos") : null,
    r.transferencias ? `${plural(r.transferencias, "transferência", "transferências")} entre suas contas` : null,
    r.faturasPagas ? plural(r.faturasPagas, "pagamento de fatura", "pagamentos de fatura") : null,
  ].filter(Boolean);
  const { notifyUser } = await import("../routines/run");
  // sem WhatsApp: uma volta por hora no celular viraria ruído; o sino e o push já chegam
  await notifyUser(userId, "Bancos sincronizados", `${partes.join(", ")}.`, null, { destino: "/app/financas", whatsapp: false, origem: "sistema" }).catch(() => undefined);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const emLotes = <T,>(xs: T[], n = 500): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const centavosDe = (x: number) => Math.round(x * 100);

interface Gravado {
  lancadas: number;
  transferencias: number;
  faturasPagas: number;
  jaExistiam: number;
  avisos: string[];
}

async function gravar(tx: Tx, userId: string, coletado: Coletado[]): Promise<Gravado> {
  const zero: Gravado = { lancadas: 0, transferencias: 0, faturasPagas: 0, jaExistiam: 0, avisos: [] };
  // a trava vale até o fim da transação: duas sincronizações do mesmo dono nunca decidem ao mesmo tempo
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"pluggy-sync:" + userId}))`);

  const [reconhecer, janelaDias, diasRepetido] = await Promise.all([
    settings.get("pluggy.reconhecerTransferencias"), settings.get("pluggy.janelaTransferenciaDias"), settings.get("finance.diasRepetido"),
  ]);

  // a conta ou o cartão da Órbita pode ter sido apagado entre a leitura da rede e agora
  const contasDaOrbita = new Set((await tx.select({ id: finConta.id }).from(finConta).where(eq(finConta.userId, userId))).map((c) => c.id));
  const cartoesDaOrbita = await tx.select().from(finCartao).where(eq(finCartao.userId, userId));
  const cartaoPorId = new Map(cartoesDaOrbita.map((c) => [c.id, c]));
  const ehCartao = new Set(coletado.filter((c) => c.conta.tipo === "CREDIT").map((c) => c.conta.id));
  const destinoDe = new Map<string, string | null>();
  for (const { conta } of coletado) {
    const id = conta.tipo === "BANK" ? conta.contaId : conta.cartaoId;
    destinoDe.set(conta.id, id && (conta.tipo === "BANK" ? contasDaOrbita.has(id) : cartaoPorId.has(id)) ? id : null);
  }

  // contas sem nenhum lançamento antes da Pluggy: o saldo inicial é acertado para bater com o banco
  const vazias = new Set<string>();
  for (const { conta } of coletado) {
    const contaId = destinoDe.get(conta.id);
    if (!contaId || conta.importadaEm || conta.tipo !== "BANK") continue;
    const [n] = await tx.select({ n: sql<number>`count(*)` }).from(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.contaId, contaId)));
    if (!Number(n?.n)) vazias.add(conta.id);
  }

  // o que já foi lido não entra de novo, nem o que o dono apagou depois de lançado
  const todas = new Map<string, TxBanco>();
  for (const { conta, txs } of coletado) if (destinoDe.get(conta.id)) for (const t of txs) todas.set(t.pluggyId, t);
  const conhecidos = new Set<string>();
  for (const lote of emLotes([...todas.keys()])) {
    const r = await tx.select({ id: pluggyTransacao.pluggyId }).from(pluggyTransacao).where(and(eq(pluggyTransacao.userId, userId), inArray(pluggyTransacao.pluggyId, lote)));
    for (const x of r) conhecidos.add(x.id);
  }
  const novas = [...todas.values()].filter((t) => !conhecidos.has(t.pluggyId));
  if (!novas.length) {
    await marcarPrimeiraLeitura(tx, coletado, destinoDe, new Map(), vazias);
    return zero;
  }
  const novasDaConta = novas.filter((t) => !ehCartao.has(t.contaRef));
  const novasDoCartao = novas.filter((t) => ehCartao.has(t.contaRef)) as TxCartao[];

  const datas = novas.map((t) => t.data).sort();
  const de = datas[0]!;
  const ate = datas[datas.length - 1]!;
  const contasLigadas = [...new Set([...destinoDe.entries()].filter(([ref, id]) => id && !ehCartao.has(ref)).map(([, id]) => id!))];
  const cartoesLigados = [...new Set([...destinoDe.entries()].filter(([ref, id]) => id && ehCartao.has(ref)).map(([, id]) => id!))];

  // pernas já lançadas (de conta, nunca de cartão) que ainda podem achar o par numa linha nova
  const soltasBrutas = await tx
    .select({ t: pluggyTransacao })
    .from(pluggyTransacao)
    .innerJoin(finLancamento, eq(finLancamento.id, pluggyTransacao.lancamentoId))
    .where(and(
      eq(pluggyTransacao.userId, userId),
      eq(pluggyTransacao.estado, "lancada"),
      isNull(pluggyTransacao.grupoTransferencia),
      eq(pluggyTransacao.terceiro, false),
      eq(finLancamento.transferencia, false),
      isNull(finLancamento.cartaoId),
      gte(pluggyTransacao.data, somarDias(de, -janelaDias)),
      lte(pluggyTransacao.data, somarDias(ate, janelaDias)),
    ));
  const soltas: PernaSolta[] = soltasBrutas.map(({ t }) => ({
    pluggyId: t.pluggyId, contaRef: t.contaRef, data: t.data, natureza: t.natureza, valor: t.valor, descricao: t.descricao,
    propria: false, terceiro: t.terceiro, lancamentoId: t.lancamentoId!,
  }));

  // o que o dono lançou à mão nas mesmas contas e cartões (a voz lança na hora, o banco só assenta depois)
  const naoVeioDoBanco = sql`not exists (select 1 from ${pluggyTransacao} pt where pt.lancamento_id = ${finLancamento.id})`;
  const janelaManual = [gte(finLancamento.data, somarDias(de, -diasRepetido)), lte(finLancamento.data, somarDias(ate, diasRepetido))];
  const manuaisDeConta: LancamentoManual[] = contasLigadas.length
    ? (await tx
        .select({ id: finLancamento.id, tipo: finLancamento.tipo, data: finLancamento.data, valor: finLancamento.valor, contaId: finLancamento.contaId })
        .from(finLancamento)
        .where(and(eq(finLancamento.userId, userId), inArray(finLancamento.contaId, contasLigadas), ...janelaManual, naoVeioDoBanco))
      ).map((m) => ({ id: m.id, natureza: m.tipo, data: m.data, valor: m.valor, contaId: m.contaId }))
    : [];
  const manuaisDeCartao: LancamentoManual[] = cartoesLigados.length
    ? (await tx
        .select({ id: finLancamento.id, tipo: finLancamento.tipo, data: finLancamento.data, valor: finLancamento.valor, cartaoId: finLancamento.cartaoId })
        .from(finLancamento)
        .where(and(eq(finLancamento.userId, userId), inArray(finLancamento.cartaoId, cartoesLigados), ...janelaManual, naoVeioDoBanco))
      ).map((m) => ({ id: m.id, natureza: m.tipo, data: m.data, valor: m.valor, contaId: m.cartaoId }))
    : [];

  // as faturas dos cartões na chave da Órbita: servem para o pagamento da conta corrente achar a sua e para a compra cair na fatura do banco
  const faturasConhecidas: FaturaConhecida[] = [];
  const fechamentoPorBill = new Map<string, Ymd | null>();
  for (const { conta, faturas } of coletado) {
    const cartaoId = destinoDe.get(conta.id);
    const cartao = cartaoId ? cartaoPorId.get(cartaoId) : null;
    if (!cartao || conta.tipo !== "CREDIT") continue;
    for (const f of faturas) {
      const chave = fechamentoDaFatura(cartao, f);
      fechamentoPorBill.set(`${conta.id}:${f.id}`, chave);
      if (chave && typeof f.totalAmount === "number") faturasConhecidas.push({ cartaoId: cartao.id, fechamento: chave, vencimento: f.dueDate.slice(0, 10), total: centavosDe(f.totalAmount), billId: f.id });
    }
  }

  const novoGrupo = () => crypto.randomUUID();
  const decisoesDaConta = planejar({
    novas: novasDaConta, soltas, manuais: manuaisDeConta, contaDe: destinoDe, janelaDias, diasRepetido,
    reconhecerTransferencias: reconhecer, compararComManuais: new Set(destinoDe.keys()), faturas: faturasConhecidas, novoGrupo,
  });
  // cartão: nada de par nem de fatura (a fatura é paga pela conta corrente); só compra, estorno e o que já estava lançado
  const decisoesDoCartao = planejar({
    novas: novasDoCartao, soltas: [], manuais: manuaisDeCartao, contaDe: destinoDe, janelaDias, diasRepetido,
    reconhecerTransferencias: false, compararComManuais: new Set(destinoDe.keys()), novoGrupo,
  });
  const decisoes = [...decisoesDaConta, ...decisoesDoCartao];

  const [categorias, regras] = await Promise.all([
    tx.select().from(finCategoria).where(eq(finCategoria.userId, userId)),
    tx.select().from(finRegra).where(eq(finRegra.userId, userId)),
  ]);
  const catsParaPalpite = categorias.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo }));
  const cache = new Map<string, string>();
  const categoriaFixa = async (chave: keyof typeof CATEGORIA_SISTEMA) => {
    if (!cache.has(chave)) cache.set(chave, await categoriaDoSistema(tx, userId, CATEGORIA_SISTEMA[chave]));
    return cache.get(chave)!;
  };
  const categoriaDeTransferencia = (natureza: "despesa" | "receita") => categoriaFixa(natureza === "despesa" ? "transferenciaSaida" : "transferenciaEntrada");

  // monta os lançamentos novos, na ordem das decisões
  const lancamentos: NovoLancamento[] = [];
  const criadas: Decisao[] = [];
  const grupos = new Set<string>();
  let pernas = 0;
  let faturasPagas = 0;
  let jaExistiam = 0;
  const avisos: string[] = [];
  for (const d of decisoes) {
    if (d.acao === "ja_existia") { jaExistiam++; continue; }
    const destino = destinoDe.get(d.tx.contaRef)!;
    const base = { tipo: d.tx.natureza, data: d.tx.data, valor: d.tx.valor, descricao: d.tx.descricao, importado: true };
    if (ehCartao.has(d.tx.contaRef)) {
      const c = d.tx as TxCartao;
      const cartao = cartaoPorId.get(destino)!;
      const chave = c.billId ? fechamentoPorBill.get(`${c.contaRef}:${c.billId}`) ?? null : null;
      lancamentos.push({
        ...base,
        data: dataNaFaturaDoBanco(cartao as Cartao, c.data, chave),
        categoriaId: c.natureza === "despesa" ? palpitarCategoria(c.descricao, regras, catsParaPalpite, "despesa") : null,
        contaId: null, cartaoId: destino, estorno: c.estorno, parcelaN: c.parcelaN, parcelaDe: c.parcelaDe,
      });
    } else if (d.acao === "lancar") {
      if (d.tx.natureza === "despesa" && faturasConhecidas.length && pareceDebitoDeFatura(d.tx.descricao)) {
        avisos.push(`${d.tx.descricao} (${brl(d.tx.valor)}) parece pagamento de fatura, mas não achei a fatura correspondente. Ficou como saída comum.`);
      }
      lancamentos.push({ ...base, categoriaId: palpitarCategoria(d.tx.descricao, regras, catsParaPalpite, d.tx.natureza), contaId: destino, cartaoId: null });
    } else if (d.acao === "pagamento_fatura") {
      faturasPagas++;
      lancamentos.push({ ...base, categoriaId: await categoriaFixa("fatura"), contaId: destino, cartaoId: null, transferencia: true });
    } else {
      pernas++;
      grupos.add(d.grupo);
      lancamentos.push({ ...base, categoriaId: await categoriaDeTransferencia(d.tx.natureza), contaId: destino, cartaoId: null, transferencia: true, grupoTransferencia: d.grupo });
    }
    criadas.push(d);
  }
  const ids = await inserirLancamentos(tx, userId, lancamentos);

  // a perna que chegou antes vira transferência junto com a que chegou agora
  for (const d of decisoes) {
    if (d.acao !== "transferencia" || !("lancamentoId" in d.par)) continue;
    await tx
      .update(finLancamento)
      .set({ transferencia: true, grupoTransferencia: d.grupo, categoriaId: await categoriaDeTransferencia(d.par.natureza) })
      .where(and(eq(finLancamento.id, d.par.lancamentoId), eq(finLancamento.userId, userId)));
    await tx.update(pluggyTransacao).set({ grupoTransferencia: d.grupo }).where(and(eq(pluggyTransacao.userId, userId), eq(pluggyTransacao.pluggyId, d.par.pluggyId)));
    grupos.add(d.grupo);
  }

  // o pagamento abate a fatura que o banco emitiu
  const idDe = new Map<Decisao, string>();
  criadas.forEach((d, i) => idDe.set(d, ids[i]!));
  for (const d of criadas) {
    if (d.acao !== "pagamento_fatura") continue;
    await tx.insert(finPagamentoFatura).values({ userId, cartaoId: d.fatura.cartaoId, fechamento: d.fatura.fechamento, valor: d.tx.valor, data: d.tx.data, lancamentoId: idDe.get(d)!, rolado: false });
  }

  // a memória do que veio do banco, na mesma transação dos lançamentos
  const registros = decisoes.map((d) => ({
    userId, contaRef: d.tx.contaRef, pluggyId: d.tx.pluggyId, data: d.tx.data, natureza: d.tx.natureza, valor: d.tx.valor, descricao: d.tx.descricao,
    terceiro: d.tx.terceiro,
    lancamentoId: d.acao === "ja_existia" ? d.lancamentoId : (idDe.get(d) ?? null),
    estado: d.acao === "ja_existia" ? ("ja_existia" as const) : ("lancada" as const),
    grupoTransferencia: d.acao === "transferencia" || d.acao === "transferencia_solta" ? d.grupo : null,
  }));
  for (const lote of emLotes(registros, 200)) await tx.insert(pluggyTransacao).values(lote).onConflictDoNothing();

  const importadasPorConta = new Map<string, { natureza: "despesa" | "receita"; valor: number }[]>();
  for (const d of criadas) {
    const lista = importadasPorConta.get(d.tx.contaRef) ?? [];
    lista.push({ natureza: d.tx.natureza, valor: d.tx.valor });
    importadasPorConta.set(d.tx.contaRef, lista);
  }
  await marcarPrimeiraLeitura(tx, coletado, destinoDe, importadasPorConta, vazias);
  return { lancadas: lancamentos.length - pernas - faturasPagas, transferencias: grupos.size, faturasPagas, jaExistiam, avisos };
}

/** Fecha a primeira leitura de cada conta e, nas contas que nasceram vazias, acerta o saldo inicial com o do banco. */
async function marcarPrimeiraLeitura(
  tx: Tx,
  coletado: Coletado[],
  destinoDe: Map<string, string | null>,
  importadas: Map<string, { natureza: "despesa" | "receita"; valor: number }[]>,
  vazias: Set<string>,
): Promise<void> {
  for (const { conta } of coletado) {
    const destino = destinoDe.get(conta.id);
    if (!destino || conta.importadaEm) continue;
    if (vazias.has(conta.id) && conta.saldoBanco !== null) {
      await tx.update(finConta).set({ saldoInicial: saldoInicialParaBater(conta.saldoBanco, importadas.get(conta.id) ?? []) }).where(eq(finConta.id, destino));
    }
    await tx.update(pluggyConta).set({ importadaEm: new Date() }).where(eq(pluggyConta.id, conta.id));
  }
}

// ── o que a tela mostra ─────────────────────────────────────────────────────

/** O widget é um script de terceiro rodando no navegador: só vale o domínio da Pluggy, por https. */
export function enderecoDoWidget(configurado: string, padrao: string): string {
  try {
    const u = new URL(configurado);
    return u.protocol === "https:" && u.hostname === "cdn.pluggy.ai" && u.pathname.endsWith(".js") ? u.toString() : padrao;
  } catch {
    return padrao;
  }
}

const WIDGET_PADRAO = "https://cdn.pluggy.ai/pluggy-connect/v2.3.1/pluggy-connect.js";

export interface VisaoDoBanco {
  conectado: boolean;
  /** de onde o navegador carrega o widget de conexão */
  widgetUrl: string;
  itens: {
    id: string;
    banco: string;
    status: string | null;
    aviso: string | null;
    erro: string | null;
    atualizadoNoBancoEm: string | null;
    sincronizadoEm: string | null;
    contas: {
      id: string;
      nome: string;
      numero: string | null;
      tipo: "BANK" | "CREDIT";
      ativa: boolean;
      /** a conta da Órbita (conta corrente) ou o cartão da Órbita (cartão) */
      contaId: string | null;
      cartaoId: string | null;
      saldoBanco: number | null;
      /** o saldo da conta da Órbita hoje, para ver se bate com o do banco */
      saldoOrbita: number | null;
      /** cartão: o que a Pluggy informou, para o dono ver antes de criar o cartão */
      limite: number | null;
      diaFechamento: number | null;
      diaVencimento: number | null;
    }[];
  }[];
}

export async function visaoDoBanco(userId: string): Promise<VisaoDoBanco> {
  const conectado = !!(await credenciaisDoDono(userId));
  const [itens, contas] = await Promise.all([
    db.select().from(pluggyItem).where(eq(pluggyItem.userId, userId)).orderBy(pluggyItem.criadoEm),
    db.select().from(pluggyConta).where(eq(pluggyConta.userId, userId)).orderBy(pluggyConta.nome),
  ]);
  const ligadas = contas.map((c) => c.contaId).filter((c): c is string => !!c);
  const saldos = new Map<string, number>();
  if (ligadas.length) {
    // duas consultas simples em vez de uma subconsulta correlacionada: o Drizzle escreve a coluna sem o nome da
    // tabela, e dentro da subconsulta "id" passa a ser o do lançamento (o saldo saía só com o saldo inicial)
    const [iniciais, somas] = await Promise.all([
      db.select({ id: finConta.id, saldoInicial: finConta.saldoInicial }).from(finConta).where(and(eq(finConta.userId, userId), inArray(finConta.id, ligadas))),
      db
        .select({ contaId: finLancamento.contaId, efeito: sql<string>`coalesce(sum(case when ${finLancamento.tipo} = 'receita' then ${finLancamento.valor} else -${finLancamento.valor} end), 0)` })
        .from(finLancamento)
        .where(and(eq(finLancamento.userId, userId), inArray(finLancamento.contaId, ligadas), isNull(finLancamento.cartaoId), lte(finLancamento.data, hojeDoServidor())))
        .groupBy(finLancamento.contaId),
    ]);
    const efeito = new Map(somas.map((r) => [r.contaId, Number(r.efeito)]));
    for (const c of iniciais) saldos.set(c.id, c.saldoInicial + (efeito.get(c.id) ?? 0));
  }
  return {
    conectado,
    widgetUrl: enderecoDoWidget(await settings.get("pluggy.widgetUrl"), WIDGET_PADRAO),
    itens: itens.map((i) => ({
      id: i.id,
      banco: i.banco,
      status: i.status,
      aviso: avisoDoStatus(i.status, i.executionStatus),
      erro: i.erro,
      atualizadoNoBancoEm: i.atualizadoNoBancoEm?.toISOString() ?? null,
      sincronizadoEm: i.sincronizadoEm?.toISOString() ?? null,
      contas: contas
        .filter((c) => c.itemRef === i.id)
        .map((c) => ({
          id: c.id, nome: c.nome, numero: c.numero, tipo: c.tipo, ativa: c.ativa, contaId: c.contaId, cartaoId: c.cartaoId,
          saldoBanco: c.saldoBanco, saldoOrbita: c.contaId ? (saldos.get(c.contaId) ?? null) : null,
          limite: c.limite, diaFechamento: c.diaFechamento, diaVencimento: c.diaVencimento,
        })),
    })),
  };
}
