import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { emailCaixa, emailTriado, type EmailTriado } from "@orbita/db/email-schema";
import { finCartao, finCompromisso, finConta } from "@orbita/db/finance-schema";
import { user } from "@orbita/db/auth-schema";
import type { Connection } from "@orbita/db/connector-schema";
import { listarContas, tokenDaConexao } from "../connectors/store";
import { rotuloDeExibicao } from "../connectors/identidade";
import { listarCaixaDesde as caixaDoGmail } from "../connectors/google";
import { listarCaixaDesde as caixaDoOutlook } from "../connectors/microsoft";
import { gerarEstruturado } from "../llm/gerar";
import { FLUXO } from "../usage/registrar";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { events } from "../events/index";
import { notifyUser } from "../routines/run";
import { criarTarefa } from "../tarefas/store";
import { executar } from "../finance/comandos";
import { RepetidoError } from "../finance/operacoes";
import { brl } from "../finance/formato";
import { hojeLocal } from "../finance/calendario";
import { remetenteLegivel } from "../meetings/aviso-de-email";
import { autenticadoPor, bancoConfiavel, cartaoDaFatura, contaDoBanco, contaQueEstePagamentoQuita, descricaoDaMovimentacao, dominioDe, enderecoDe, lerCobranca, lerMovimentacao, type Cobranca } from "./banco";
import { decidirPorRegra, decidirSemModelo, decisoesDoModelo, linkDoGmail, pedidoDaTriagem, type Categoria, type Decisao, type EmailDaCaixa } from "./triagem";

/**
 * A triagem das caixas do dono, por polling (o mesmo laço da antiga vigia do
 * Gmail, que ela substitui): lê cada conta a partir do marcador DELA, separa
 * em ação, útil e ruído, transforma ação em tarefa e movimentação do banco
 * em lançamento, e avisa.
 *
 * Ordem de operações que importa: a linha do e-mail é gravada ANTES do efeito
 * (tarefa, lançamento), com chave única por (conta, mensagem). Se o processo
 * cair no meio, a volta seguinte vê a linha e não repete a tarefa nem o
 * lançamento; o pior caso é um efeito que ficou por fazer, nunca um em dobro.
 * O marcador da conta só avança até a última mensagem gravada.
 */

const LOTE_DO_MODELO = 15;

type Provedor = "google" | "microsoft";

async function lerCaixa(provedor: Provedor, token: string, desde: Date, max: number, conta: string | null): Promise<EmailDaCaixa[]> {
  if (provedor === "google") {
    return (await caixaDoGmail(token, desde, max)).map((m) => ({
      mensagemId: m.id,
      de: m.from,
      assunto: m.subject,
      trecho: m.snippet,
      recebidoEm: m.internalDate,
      rotulos: m.labelIds,
      deLista: m.listUnsubscribe,
      outlookOutros: false,
      autenticacao: m.authResults,
      link: linkDoGmail(conta, m.id),
    }));
  }
  return (await caixaDoOutlook(token, desde, max)).map((m) => ({
    mensagemId: m.id,
    de: m.from,
    assunto: m.subject,
    trecho: m.snippet,
    recebidoEm: m.recebidaEm,
    rotulos: [],
    deLista: m.listUnsubscribe,
    outlookOutros: m.outros,
    autenticacao: m.authResults,
    link: m.webLink,
  }));
}

async function meuNome(userId: string): Promise<string> {
  const fixo = (await settings.get("meetings.meuNome").catch(() => "")) as string;
  if (fixo?.trim()) return fixo.trim();
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return u?.name ?? "";
}

/** O modelo decide em lotes; quem ele não decidiu (ou se ele falhar) cai na regra sem modelo. */
async function decidirComModelo(userId: string, emails: EmailDaCaixa[]): Promise<Decisao[]> {
  const saida: Decisao[] = emails.map(decidirSemModelo);
  const nome = await meuNome(userId);
  const hoje = hojeLocal();
  for (let i = 0; i < emails.length; i += LOTE_DO_MODELO) {
    const lote = emails.slice(i, i + LOTE_DO_MODELO);
    try {
      const { system, prompt } = pedidoDaTriagem(lote, { meuNome: nome, hoje });
      const { dados } = await gerarEstruturado({ userId, fluxo: FLUXO.rotina, referencia: "emails.triagem", system, prompt }, z.unknown());
      const decisoes = decisoesDoModelo(dados, lote.length);
      lote.forEach((_, j) => {
        const d = decisoes.get(j + 1);
        if (d) saida[i + j] = d;
      });
    } catch (e) {
      log.warn("emails.triagem_sem_modelo", { erro: e instanceof Error ? e.message : String(e), emails: lote.length });
    }
  }
  return saida;
}

interface Efeitos {
  acoes: { assunto: string; de: string; resumo: string; tarefa: string | null; conta: string; mensagemId: string }[];
  /** uma linha por efeito no financeiro, já em linguagem de gente */
  financas: string[];
}

/**
 * O que o e-mail faz no financeiro, a partir da linha JÁ GRAVADA (serve ao
 * e-mail novo e à reavaliação dos que chegaram antes):
 *
 * - movimentação feita (Pix, pagamento) vai para o extrato; se ela paga uma
 *   conta que estava em aberto, a conta é dada como paga em vez de virar um
 *   lançamento a mais (o boleto contaria duas vezes);
 * - cobrança (boleto, fatura) vira conta a pagar ou a receber; fatura de
 *   cartão já cadastrado não entra, o financeiro já a calcula pelas compras.
 *
 * Sozinho, só com banco confiável E e-mail assinado pelo domínio dele
 * (`banco.ts`): boleto falso é golpe comum, e agendá-lo daria a ele cara de
 * conta de verdade. Fora disso fica "pendente", com o botão na tela.
 */
type EstadoFinanceiro = "lancado" | "quitado" | "agendado" | "no_cartao" | "repetido" | "pendente" | "nada";

async function abertasDo(userId: string) {
  return db
    .select({ id: finCompromisso.id, direcao: finCompromisso.direcao, valor: finCompromisso.valor, vencimento: finCompromisso.vencimento, descricao: finCompromisso.descricao })
    .from(finCompromisso)
    .where(and(eq(finCompromisso.userId, userId), eq(finCompromisso.status, "aberto")));
}

export function descricaoDaCobranca(de: string, c: Cobranca): string {
  const quem = c.emissor ?? remetenteLegivel(de);
  if (c.direcao === "receber") return `A receber: ${quem}`;
  return c.fatura ? `Fatura ${remetenteLegivel(de)}` : `Boleto ${quem}`;
}

async function efeitoFinanceiro(userId: string, l: EmailTriado, bancos: string[], efeitos: Efeitos): Promise<EstadoFinanceiro> {
  const marcar = async (estado: EstadoFinanceiro, extra: Partial<typeof emailTriado.$inferInsert> = {}) => {
    await db.update(emailTriado).set({ lancamento: estado, ...extra }).where(eq(emailTriado.id, l.id));
    return estado;
  };
  if (l.categoria === "ruido") return marcar("nada");
  const hoje = hojeLocal();
  const data = hojeLocal(l.recebidoEm);
  const mov = lerMovimentacao(l.assunto, l.trecho);
  const cob = mov ? null : lerCobranca(l.assunto, l.trecho, hoje);
  if (!mov && !cob) return marcar("nada");
  const registro = mov ?? { natureza: cob!.direcao === "pagar" ? ("despesa" as const) : ("receita" as const), valor: cob!.valor, contraparte: cob!.emissor, vencimento: cob!.vencimento };
  await db.update(emailTriado).set({ movimentacao: registro }).where(eq(emailTriado.id, l.id));

  const dominio = dominioDe(l.remetente);
  if (!bancoConfiavel(l.remetente, bancos) || !l.autenticado || !(await settings.get("emails.lancarAutomatico"))) return marcar("pendente");
  const contas = await db.select({ id: finConta.id, nome: finConta.nome }).from(finConta).where(eq(finConta.userId, userId));
  const conta = contaDoBanco(contas, dominio);
  try {
    if (mov) {
      const quita = contaQueEstePagamentoQuita(await abertasDo(userId), mov, data);
      if (quita) {
        await executar(userId, { tipo: "quitar", id: quita.id, valor: mov.valor, data, contaId: conta?.id ?? null }, hoje);
        efeitos.financas.push(`${mov.natureza === "receita" ? "Recebi" : "Paguei"} "${quita.descricao}" (${brl(mov.valor)}), que estava em contas a ${quita.direcao}.`);
        return marcar("quitado", { lancamentoId: quita.id });
      }
      // sem saber a conta, o saldo de duas contas ficaria errado: o dono escolhe
      if (!conta) return marcar("pendente");
      const r = await executar(userId, { tipo: "lancar", natureza: mov.natureza, valor: mov.valor, data, descricao: descricaoDaMovimentacao(mov), contaId: conta.id }, hoje);
      efeitos.financas.push(`${mov.natureza === "receita" ? "Entrada" : "Saída"} de ${brl(mov.valor)} no extrato: ${descricaoDaMovimentacao(mov)}.`);
      return marcar("lancado", { lancamentoId: r.id ?? null });
    }
    const c = cob!;
    const cartoes = await db.select({ id: finCartao.id, nome: finCartao.nome }).from(finCartao).where(eq(finCartao.userId, userId));
    if (cartaoDaFatura(cartoes, c, dominio)) return marcar("no_cartao");
    const igual = (await abertasDo(userId)).find((a) => a.direcao === c.direcao && a.valor === c.valor && Math.abs(Date.parse(a.vencimento) - Date.parse(c.vencimento)) <= 3 * 86_400_000);
    if (igual) return marcar("repetido", { lancamentoId: igual.id });
    const descricao = descricaoDaCobranca(l.de, c);
    const r = await executar(userId, { tipo: "salvar_compromisso", direcao: c.direcao, descricao, valor: c.valor, vencimento: c.vencimento, contaId: conta?.id ?? null, recorrente: false }, hoje);
    efeitos.financas.push(`${descricao}: ${brl(c.valor)}, vence ${c.vencimento.slice(8, 10)}/${c.vencimento.slice(5, 7)}. Pus em contas a ${c.direcao}.`);
    return marcar("agendado", { lancamentoId: r.id ?? null });
  } catch (err) {
    // o dono já lançou à mão (ou outro e-mail do mesmo Pix): não lança de novo
    if (err instanceof RepetidoError) return marcar("repetido");
    log.warn("emails.financeiro_falhou", { erro: err instanceof Error ? err.message : String(err) });
    return marcar("pendente");
  }
}

/**
 * Reavalia os e-mails dos últimos dias que ainda não tiveram efeito no
 * financeiro: os que chegaram antes desta regra existir, e os pendentes de um
 * banco em que o dono acabou de confiar.
 */
async function reavaliarFinancas(userId: string, bancos: string[], efeitos: Efeitos): Promise<void> {
  const linhas = await db
    .select()
    .from(emailTriado)
    .where(and(eq(emailTriado.userId, userId), or(isNull(emailTriado.lancamento), eq(emailTriado.lancamento, "pendente")), gte(emailTriado.recebidoEm, new Date(Date.now() - 7 * 86_400_000))))
    .limit(100);
  for (const l of linhas) await efeitoFinanceiro(userId, l, bancos, efeitos);
}

async function triarConta(userId: string, conexao: Connection, posicao: number, efeitos: Efeitos): Promise<number> {
  const provedor = conexao.provider as Provedor;
  const rotulo = rotuloDeExibicao(conexao.accountLabel, posicao);
  const cfg = await settings.getMany(["emails.porVolta", "emails.janelaInicialHoras", "emails.bancos", "emails.criarTarefas"]);
  const [caixa] = await db.select().from(emailCaixa).where(eq(emailCaixa.conexaoId, conexao.id)).limit(1);
  const desde = caixa?.vistoAte ?? new Date(Date.now() - cfg["emails.janelaInicialHoras"] * 3_600_000);
  const primeiraVez = !caixa;

  const token = await tokenDaConexao(conexao);
  const lidas = await lerCaixa(provedor, token, desde, cfg["emails.porVolta"], conexao.accountLabel);
  const ja = lidas.length
    ? new Set((await db.select({ m: emailTriado.mensagemId }).from(emailTriado).where(and(eq(emailTriado.conexaoId, conexao.id), inArray(emailTriado.mensagemId, lidas.map((x) => x.mensagemId))))).map((x) => x.m))
    : new Set<string>();
  const novas = lidas.filter((x) => !ja.has(x.mensagemId));

  const bancos = cfg["emails.bancos"];
  const porRegra = novas.map((e) => decidirPorRegra(e, bancos));
  const paraOModelo = novas.filter((_, i) => !porRegra[i]);
  const doModelo = paraOModelo.length ? await decidirComModelo(userId, paraOModelo) : [];
  let k = 0;
  const decisoes = porRegra.map((d) => d ?? doModelo[k++]!);

  for (const [i, e] of novas.entries()) {
    const d = decisoes[i]!;
    const [linha] = await db
      .insert(emailTriado)
      .values({
        userId,
        conexaoId: conexao.id,
        provedor,
        mensagemId: e.mensagemId,
        de: e.de.slice(0, 300),
        remetente: enderecoDe(e.de),
        assunto: e.assunto.slice(0, 500),
        trecho: e.trecho.slice(0, 1000),
        recebidoEm: e.recebidoEm,
        categoria: d.categoria,
        resumo: d.resumo ?? null,
        classificadoPor: d.por,
        oQueFazer: d.oQueFazer ?? null,
        prazo: d.prazo ?? null,
        autenticado: autenticadoPor(e.autenticacao, dominioDe(enderecoDe(e.de))),
        link: e.link,
      })
      .onConflictDoNothing()
      .returning();
    if (!linha) continue; // outra volta gravou primeiro: o efeito é dela

    if (d.categoria === "acao" && d.oQueFazer && cfg["emails.criarTarefas"]) {
      // "pode virar uma tarefa no dia": sem prazo no e-mail, vence hoje
      const t = await criarTarefa(userId, {
        texto: d.oQueFazer,
        vencimento: d.prazo ?? hojeLocal(),
        origem: { tipo: "email", id: linha.id, titulo: e.assunto.slice(0, 200), trecho: d.resumo ?? e.trecho.slice(0, 300) },
      });
      if (t) await db.update(emailTriado).set({ tarefaId: t.id }).where(eq(emailTriado.id, linha.id));
    }
    await efeitoFinanceiro(userId, linha, bancos, efeitos);
    // a primeira leitura de uma conta traz o histórico recente: avisar dele seria uma enxurrada
    if (d.categoria === "acao" && !primeiraVez) {
      efeitos.acoes.push({ assunto: e.assunto, de: e.de, resumo: d.resumo ?? e.trecho.slice(0, 200), tarefa: d.oQueFazer && cfg["emails.criarTarefas"] ? d.oQueFazer : null, conta: rotulo, mensagemId: e.mensagemId });
    }
  }

  // o marcador só passa do que foi lido: com `max` estourado, o resto vem na próxima volta
  const ate = lidas.reduce((m, x) => (x.recebidoEm > m ? x.recebidoEm : m), desde);
  await db
    .insert(emailCaixa)
    .values({ conexaoId: conexao.id, userId, vistoAte: ate, falhas: 0 })
    .onConflictDoUpdate({ target: emailCaixa.conexaoId, set: { vistoAte: ate, falhas: 0, atualizadoEm: new Date() } });
  return novas.length;
}

/** Uma volta para um dono: todas as contas de Google e Microsoft. */
export async function triarCaixas(userId: string): Promise<{ contas: number; novos: number; falhas: string[] }> {
  const efeitos: Efeitos = { acoes: [], financas: [] };
  const falhas: string[] = [];
  let novos = 0;
  let contas = 0;
  for (const provedor of ["google", "microsoft"] as const) {
    const lista = await listarContas(userId, provedor);
    for (const [i, c] of lista.entries()) {
      contas++;
      try {
        novos += await triarConta(userId, c, i + 1, efeitos);
      } catch (e) {
        // uma conta fora do ar não segura as outras
        falhas.push(rotuloDeExibicao(c.accountLabel, i + 1));
        log.warn("emails.conta_falhou", { provedor, erro: e instanceof Error ? e.message : String(e) });
        await db.update(emailCaixa).set({ falhas: sql`${emailCaixa.falhas} + 1` }).where(eq(emailCaixa.conexaoId, c.id));
      }
    }
  }
  await reavaliarFinancas(userId, await settings.get("emails.bancos"), efeitos).catch((e) => log.warn("emails.reavaliar_falhou", { erro: e instanceof Error ? e.message : String(e) }));
  await avisar(userId, efeitos);
  return { contas, novos, falhas };
}

/**
 * O aviso de ação sai pelo EVENTO de sempre (`gmail.important_received`), que
 * a regra padrão "Avisar e-mail importante" transforma em aviso: o dono
 * continua podendo editar ou desligar pela tela de Regras, e as regras que
 * ele escreveu sobre esse evento continuam valendo. Os lançamentos saem num
 * aviso só por volta, para dar para conferir e desfazer.
 */
async function avisar(userId: string, ef: Efeitos): Promise<void> {
  for (const a of ef.acoes) {
    const resumo = a.tarefa ? `${a.resumo}\n\nCriei a tarefa "${a.tarefa}" para você.` : a.resumo;
    await events.emit("gmail.important_received", { messageId: a.mensagemId, de: a.de, assunto: a.assunto, trecho: a.resumo, conta: a.conta, remetente: remetenteLegivel(a.de), resumo }, { userId });
  }
  if (ef.financas.length) {
    await notifyUser(userId, ef.financas.length === 1 ? "Atualizei suas finanças pelo e-mail do banco" : `${ef.financas.length} atualizações nas suas finanças`, `${ef.financas.join("\n")}\n\nVeio dos e-mails do banco. Se algo estiver errado, dá para desfazer em Finanças.`, null, { destino: "/app/financas" });
  }
}

/** Os donos com alguma caixa conectada (o laço passa por eles). */
export async function donosComCaixa(): Promise<string[]> {
  const { usersConnected } = await import("../connectors/store");
  return [...new Set([...(await usersConnected("google")), ...(await usersConnected("microsoft"))])];
}

// ── leitura e ações da tela ────────────────────────────────────────────────

export interface EmailsDaTela {
  /** quantas caixas estão conectadas: zero, a tela ensina a conectar em vez de mostrar vazio */
  caixas: number;
  contagem: Record<Categoria, number>;
  itens: (EmailTriado & { conta: string })[];
}

export async function emailsDe(userId: string, categoria: Categoria, limite = 30): Promise<EmailsDaTela> {
  const contas = new Map<string, string>();
  for (const p of ["google", "microsoft"] as const) (await listarContas(userId, p)).forEach((c, i) => contas.set(c.id, rotuloDeExibicao(c.accountLabel, i + 1)));
  const abertos = and(eq(emailTriado.userId, userId), eq(emailTriado.resolvido, false));
  const linhas = await db.select().from(emailTriado).where(and(abertos, eq(emailTriado.categoria, categoria))).orderBy(desc(emailTriado.recebidoEm)).limit(limite);
  const porCategoria = await db.select({ categoria: emailTriado.categoria, n: sql<number>`count(*)::int` }).from(emailTriado).where(abertos).groupBy(emailTriado.categoria);
  const contagem = { acao: 0, util: 0, ruido: 0 } as Record<Categoria, number>;
  for (const r of porCategoria) if (r.categoria in contagem) contagem[r.categoria as Categoria] = r.n;
  return { caixas: contas.size, contagem, itens: linhas.map((l) => ({ ...l, conta: contas.get(l.conexaoId) ?? "" })) };
}

export class AcaoDeEmailInvalida extends Error {}

async function linhaDoDono(userId: string, id: string): Promise<EmailTriado> {
  const [l] = await db.select().from(emailTriado).where(and(eq(emailTriado.id, id), eq(emailTriado.userId, userId))).limit(1);
  if (!l) throw new AcaoDeEmailInvalida("E-mail não encontrado.");
  return l;
}

export async function resolverEmail(userId: string, id: string, resolvido = true): Promise<void> {
  await linhaDoDono(userId, id);
  await db.update(emailTriado).set({ resolvido }).where(eq(emailTriado.id, id));
}

/** O dono moveu de aba: a decisão dele vale e fica registrada como dele. */
export async function moverEmail(userId: string, id: string, categoria: Categoria): Promise<void> {
  await linhaDoDono(userId, id);
  await db.update(emailTriado).set({ categoria, classificadoPor: "dono" }).where(eq(emailTriado.id, id));
}

export async function tarefaDoEmail(userId: string, id: string, texto?: string): Promise<string> {
  const l = await linhaDoDono(userId, id);
  if (l.tarefaId) return l.tarefaId;
  const t = await criarTarefa(userId, {
    texto: (texto?.trim() || l.oQueFazer || `Responder: ${l.assunto}`).slice(0, 300),
    vencimento: l.prazo ?? hojeLocal(),
    origem: { tipo: "email", id: l.id, titulo: l.assunto.slice(0, 200), trecho: l.resumo ?? l.trecho.slice(0, 300) },
  });
  if (!t) throw new AcaoDeEmailInvalida("Não consegui criar a tarefa.");
  await db.update(emailTriado).set({ tarefaId: t.id }).where(eq(emailTriado.id, l.id));
  return t.id;
}

/** O botão "Lançar" da tela: a movimentação lida, na conta que o dono escolheu. */
export async function lancarDoEmail(userId: string, id: string, contaId: string): Promise<string> {
  const l = await linhaDoDono(userId, id);
  if (!l.movimentacao) throw new AcaoDeEmailInvalida("Este e-mail não tem movimentação para lançar.");
  if (l.lancamento === "lancado") throw new AcaoDeEmailInvalida("Esta movimentação já foi lançada.");
  const r = await executar(userId, { tipo: "lancar", natureza: l.movimentacao.natureza, valor: l.movimentacao.valor, data: hojeLocal(l.recebidoEm), descricao: descricaoDaMovimentacao(l.movimentacao), contaId }, hojeLocal());
  await db.update(emailTriado).set({ lancamento: "lancado", lancamentoId: r.id ?? null }).where(eq(emailTriado.id, l.id));
  return r.mensagem;
}

/** O botão "Adicionar às contas": a cobrança pendente vira conta a pagar ou a receber. */
export async function agendarDoEmail(userId: string, id: string): Promise<string> {
  const l = await linhaDoDono(userId, id);
  const m = l.movimentacao;
  if (!m?.vencimento) throw new AcaoDeEmailInvalida("Este e-mail não tem cobrança com vencimento.");
  if (l.lancamento === "agendado") throw new AcaoDeEmailInvalida("Esta conta já está em Finanças.");
  const c: Cobranca = { direcao: m.natureza === "despesa" ? "pagar" : "receber", valor: m.valor, vencimento: m.vencimento, fatura: /fatura/i.test(l.assunto), finalDoCartao: null, emissor: m.contraparte };
  const descricao = descricaoDaCobranca(l.de, c);
  const r = await executar(userId, { tipo: "salvar_compromisso", direcao: c.direcao, descricao, valor: c.valor, vencimento: c.vencimento, recorrente: false }, hojeLocal());
  await db.update(emailTriado).set({ lancamento: "agendado", lancamentoId: r.id ?? null }).where(eq(emailTriado.id, l.id));
  return `${descricao} está em contas a ${c.direcao}.`;
}

/** "Confiar neste banco": o domínio do remetente entra na lista, e os próximos lançam sozinhos. */
export async function confiarNoBanco(userId: string, id: string): Promise<string> {
  const l = await linhaDoDono(userId, id);
  const dominio = dominioDe(l.remetente);
  if (!dominio) throw new AcaoDeEmailInvalida("Não sei o domínio deste remetente.");
  const atuais = await settings.get("emails.bancos");
  if (!bancoConfiavel(l.remetente, atuais)) await settings.set("emails.bancos", [...atuais, dominio]);
  return dominio;
}

/** Limpa o que passou da validade (o e-mail continua na caixa; aqui é só a triagem). */
export async function podarEmails(userId: string): Promise<void> {
  const dias = await settings.get("emails.diasGuardar");
  await db.delete(emailTriado).where(and(eq(emailTriado.userId, userId), lt(emailTriado.recebidoEm, new Date(Date.now() - dias * 86_400_000))));
}
