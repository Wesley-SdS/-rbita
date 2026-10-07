import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { trabalhoConta, trabalhoNovidade, type TrabalhoNovidade } from "@orbita/db/trabalho-schema";
import type { Connection } from "@orbita/db/connector-schema";
import { listarContas, tokenDaConexao, usersConnected } from "../connectors/store";
import { rotuloDeExibicao } from "../connectors/identidade";
import { meuLogin, minhasPrs, novidadesDaPr, prsEsperandoMeuReview } from "../connectors/github";
import { oQueChegouNoSlack } from "../connectors/slack";
import { minhasIssues, type JiraIssue } from "../connectors/jira";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { notifyUser } from "../routines/run";
import { textoDoAvisoDeTrabalho, type NovidadeParaAviso } from "./aviso";

/**
 * O trabalho do dono em um lugar só: as pendências dos Jiras (lidas ao vivo,
 * porque a pendência É o estado de agora) e os EVENTOS do GitHub e do Slack
 * (review, comentário, pedido de review, menção, mensagem direta), que são
 * guardados para serem avisados uma vez só.
 *
 * A linha do evento é gravada antes do aviso, com chave única por (conta,
 * evento): processo que cai no meio deixa, no pior caso, um aviso por dar,
 * nunca um em dobro. A primeira leitura de uma conta guarda o que já existia
 * como visto, sem avisar: conectar o GitHub não pode virar 40 avisos.
 */

interface Lido {
  eventoId: string;
  tipo: string;
  contexto: string;
  autor: string;
  estado: string | null;
  trecho: string;
  url: string | null;
  quando: Date;
}

async function lerGithub(token: string, conexao: Connection, desde: Date): Promise<Lido[]> {
  const eu = await meuLogin(token, conexao.id);
  const [minhas, pedidas] = await Promise.all([minhasPrs(token), prsEsperandoMeuReview(token)]);
  const lidos: Lido[] = pedidas.map((pr) => ({
    // um pedido por PR: ele É uma pendência, e repetir o aviso a cada commit seria ruído
    eventoId: `pedido:${pr.id}`,
    tipo: "pedido_review",
    contexto: `${pr.repo}#${pr.numero}: ${pr.titulo}`,
    autor: pr.autor,
    estado: null,
    trecho: "",
    url: pr.url,
    quando: new Date(pr.atualizadaEm),
  }));
  // só as PRs mexidas depois do marcador: as paradas não têm o que trazer
  for (const pr of minhas.filter((p) => new Date(p.atualizadaEm) >= desde)) {
    for (const n of await novidadesDaPr(token, pr, desde, eu)) {
      lidos.push({ eventoId: n.eventoId, tipo: n.tipo, contexto: `${pr.repo}#${pr.numero}: ${pr.titulo}`, autor: n.autor, estado: n.estado, trecho: n.texto.slice(0, 600), url: n.url, quando: new Date(n.quando) });
    }
  }
  return lidos;
}

async function lerSlack(token: string, conexao: Connection, desde: Date): Promise<Lido[]> {
  return (await oQueChegouNoSlack(token, conexao.id, desde)).map((m) => ({ eventoId: m.eventoId, tipo: m.tipo, contexto: m.canal, autor: m.autor, estado: null, trecho: m.texto.slice(0, 600), url: m.url, quando: m.quando }));
}

async function vigiarConta(userId: string, provedor: "github" | "slack", conexao: Connection, rotulo: string, novas: NovidadeParaAviso[]): Promise<void> {
  const comecou = new Date();
  const [conta] = await db.select().from(trabalhoConta).where(eq(trabalhoConta.conexaoId, conexao.id)).limit(1);
  const dias = await settings.get("trabalho.diasOlhar");
  const desde = conta?.vistoAte ?? new Date(Date.now() - dias * 86_400_000);
  const primeiraVez = !conta;
  const token = await tokenDaConexao(conexao);
  const lidos = provedor === "github" ? await lerGithub(token, conexao, desde) : await lerSlack(token, conexao, desde);
  for (const l of lidos) {
    const [linha] = await db
      .insert(trabalhoNovidade)
      .values({ userId, conexaoId: conexao.id, provedor, eventoId: l.eventoId.slice(0, 200), tipo: l.tipo, contexto: l.contexto.slice(0, 300), autor: l.autor.slice(0, 120), estado: l.estado, trecho: l.trecho, url: l.url, quando: l.quando, visto: primeiraVez })
      .onConflictDoNothing()
      .returning();
    if (linha && !primeiraVez) novas.push({ provedor, tipo: l.tipo, contexto: l.contexto, autor: l.autor, estado: l.estado, trecho: l.trecho, conta: rotulo });
  }
  // o marcador vai para o INÍCIO da volta: o que chegou enquanto ela rodava entra na próxima
  await db
    .insert(trabalhoConta)
    .values({ conexaoId: conexao.id, userId, vistoAte: comecou, falhas: 0 })
    .onConflictDoUpdate({ target: trabalhoConta.conexaoId, set: { vistoAte: comecou, falhas: 0, atualizadoEm: new Date() } });
}

/** Uma volta para um dono: todas as contas de GitHub e de Slack. */
export async function vigiarTrabalho(userId: string): Promise<{ novas: number; falhas: string[] }> {
  const novas: NovidadeParaAviso[] = [];
  const falhas: string[] = [];
  for (const provedor of ["github", "slack"] as const) {
    for (const [i, c] of (await listarContas(userId, provedor)).entries()) {
      const rotulo = rotuloDeExibicao(c.accountLabel, i + 1);
      try {
        await vigiarConta(userId, provedor, c, rotulo, novas);
      } catch (e) {
        falhas.push(`${provedor === "github" ? "GitHub" : "Slack"} ${rotulo}`);
        log.warn("trabalho.conta_falhou", { provedor, erro: e instanceof Error ? e.message : String(e) });
        await db.update(trabalhoConta).set({ falhas: sql`${trabalhoConta.falhas} + 1` }).where(eq(trabalhoConta.conexaoId, c.id));
      }
    }
  }
  if (novas.length && (await settings.get("trabalho.avisar"))) {
    const { titulo, corpo } = textoDoAvisoDeTrabalho(novas);
    await notifyUser(userId, titulo, corpo, null, { destino: "/app" });
  }
  return { novas: novas.length, falhas };
}

export async function donosComTrabalho(): Promise<string[]> {
  return [...new Set([...(await usersConnected("github")), ...(await usersConnected("slack"))])];
}

// ── a visão consolidada (tela, chat, voz) ──────────────────────────────────

export interface TrabalhoDoDono {
  conectados: { jira: number; github: number; slack: number };
  jira: (JiraIssue & { site: string })[];
  jiraFalhas: string[];
  github: TrabalhoNovidade[];
  slack: TrabalhoNovidade[];
}

/** Novidades que ainda importam: não vistas, dos últimos dias. O pedido de review fica até a PR sair da lista. */
async function novidades(userId: string, provedor: string): Promise<TrabalhoNovidade[]> {
  const dias = await settings.get("trabalho.diasOlhar");
  return db
    .select()
    .from(trabalhoNovidade)
    .where(and(eq(trabalhoNovidade.userId, userId), eq(trabalhoNovidade.provedor, provedor), eq(trabalhoNovidade.visto, false), gte(trabalhoNovidade.quando, new Date(Date.now() - dias * 86_400_000))))
    .orderBy(desc(trabalhoNovidade.quando))
    .limit(40);
}

export async function trabalhoDe(userId: string): Promise<TrabalhoDoDono> {
  const [contasJira, contasGithub, contasSlack] = await Promise.all([listarContas(userId, "jira"), listarContas(userId, "github"), listarContas(userId, "slack")]);
  let jira: TrabalhoDoDono["jira"] = [];
  let jiraFalhas: string[] = [];
  if (contasJira.length) {
    // import tardio: o domínio de tools do Jira registra tools ao ser carregado
    const { lerEmTodosOsSites } = await import("../tools/domains/jira");
    const r = await lerEmTodosOsSites(userId, (t, s) => minhasIssues(t, s.cloudId, 25, s.url));
    jira = r.issues;
    jiraFalhas = r.falhas;
  }
  const [github, slack] = await Promise.all([novidades(userId, "github"), novidades(userId, "slack")]);
  return { conectados: { jira: contasJira.length, github: contasGithub.length, slack: contasSlack.length }, jira, jiraFalhas, github, slack };
}

export async function marcarVisto(userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const r = await db.update(trabalhoNovidade).set({ visto: true }).where(and(eq(trabalhoNovidade.userId, userId), inArray(trabalhoNovidade.id, ids))).returning({ id: trabalhoNovidade.id });
  return r.length;
}

export async function podarTrabalho(userId: string): Promise<void> {
  const dias = await settings.get("trabalho.diasGuardar");
  await db.delete(trabalhoNovidade).where(and(eq(trabalhoNovidade.userId, userId), lt(trabalhoNovidade.quando, new Date(Date.now() - dias * 86_400_000))));
}
