import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { trabalhoDe } from "../../trabalho/servico";
import { enqueueJob } from "../../jobs/queue";

/**
 * Domínio: o trabalho consolidado (`trabalho/servico.ts`). "O que eu tenho de
 * pendência?" responde com os Jiras (todos os sites, todas as contas), o que
 * chegou nas PRs do GitHub e as menções do Slack, num cartão com abas.
 * `jira_minhas_tarefas` continua para quem quer só o Jira, e com JQL.
 */

const GITHUB: Record<string, string> = { review: "review", comentario: "comentário", pedido_review: "pedido de review" };
const ESTADO: Record<string, string> = { APPROVED: "aprovou", CHANGES_REQUESTED: "pediu mudanças", COMMENTED: "comentou" };

export const meu_trabalho: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "meu_trabalho",
  domain: "trabalho",
  description:
    "As pendências de trabalho do dono num lugar só: issues abertas de TODOS os Jiras conectados, reviews e comentários nas PRs dele e PRs esperando o review dele no GitHub, e menções e mensagens diretas no Slack. Use para \"o que eu tenho de pendência?\", \"teve review nas minhas PRs?\", \"alguém me chamou no Slack?\".",
  risk: "leitura",
  keywords: ["pendência", "pendências", "trabalho", "jira", "github", "pr", "review", "slack", "menção", "o que tenho para fazer"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const t = await trabalhoDe(userId);
    if (!t.conectados.jira && !t.conectados.github && !t.conectados.slack) return { erro: "Nenhum Jira, GitHub ou Slack conectado. Dá para conectar por token em Conexões." };
    return {
      conectados: t.conectados,
      jira: t.jira.map((i) => ({ chave: i.chave, titulo: i.titulo, status: i.status, prioridade: i.prioridade, vencimento: i.vencimento, site: i.site, link: i.link })),
      jira_que_falharam: t.jiraFalhas,
      github: t.github.map((n) => ({ tipo: GITHUB[n.tipo] ?? n.tipo, pr: n.contexto, autor: n.autor, acao: n.estado ? ESTADO[n.estado] ?? n.estado : null, trecho: n.trecho.slice(0, 300), quando: n.quando.toISOString(), link: n.url })),
      slack: t.slack.map((n) => ({ tipo: n.tipo === "mensagem_direta" ? "mensagem direta" : "menção", onde: n.contexto, autor: n.autor, trecho: n.trecho.slice(0, 300), quando: n.quando.toISOString(), link: n.url })),
    };
  },
};

export const atualizar_meu_trabalho: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "atualizar_meu_trabalho",
  domain: "trabalho",
  description: "Olha o GitHub e o Slack agora, sem esperar a próxima volta.",
  risk: "escrita",
  keywords: ["atualizar", "github", "slack", "agora"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    await enqueueJob(userId, { kind: "trabalho.vigiar", payload: {}, dedupKey: `trabalho-agora:${userId}` });
    return { mensagem: "Estou olhando o GitHub e o Slack agora. O que chegar aparece na tela inicial." };
  },
};

registerTools([meu_trabalho, atualizar_meu_trabalho]);
