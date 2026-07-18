import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getAccessToken, connectedProviders } from "@/lib/connectors/store";
import { listRecentEmails, createDraft, sendEmail, listUpcomingEvents, createEvent } from "@/lib/connectors/google";
import { searchNotion, readNotionPage } from "@/lib/connectors/notion";
import { listChannels, postMessage } from "@/lib/connectors/slack";
import { whatsappConfigured, sendWhatsApp } from "@/lib/connectors/whatsapp";

/**
 * Ferramentas dos conectores — só entram no chat para os serviços que o usuário
 * de fato conectou. Ações com efeito colateral (enviar e-mail, criar evento,
 * postar no Slack) exigem `confirmar: true`; sem isso, devolvem uma PROPOSTA e
 * não executam nada (exigência do PRD: confirmação para ações destrutivas).
 */
export async function buildConnectorTools(userId: string): Promise<ToolSet> {
  const connected = await connectedProviders(userId);
  const tools: ToolSet = {};

  if (connected.has("google")) {
    tools.ler_emails = tool({
      description: "Lê os e-mails recentes da caixa de entrada do Gmail do usuário. Use `consulta` para filtrar (sintaxe do Gmail, ex: 'from:cliente is:unread').",
      inputSchema: z.object({ consulta: z.string().optional(), quantidade: z.number().int().min(1).max(10).default(5) }),
      execute: async ({ consulta, quantidade }) => {
        const token = await getAccessToken("google", userId);
        if (!token) return { erro: "Google não conectado" };
        const emails = await listRecentEmails(token, quantidade, consulta || "in:inbox");
        return { emails };
      },
    });
    tools.rascunhar_email = tool({
      description: "Cria um RASCUNHO de e-mail no Gmail (não envia). Ação segura para revisão.",
      inputSchema: z.object({ para: z.string(), assunto: z.string(), corpo: z.string() }),
      execute: async ({ para, assunto, corpo }) => {
        const token = await getAccessToken("google", userId);
        if (!token) return { erro: "Google não conectado" };
        const d = await createDraft(token, para, assunto, corpo);
        return { rascunho_criado: true, id: d.id, para, assunto };
      },
    });
    tools.enviar_email = tool({
      description: "ENVIA um e-mail pelo Gmail. Ação irreversível: só chame com confirmar=true DEPOIS que o usuário aprovar explicitamente o texto. Sem confirmar, devolve a proposta para revisão.",
      inputSchema: z.object({ para: z.string(), assunto: z.string(), corpo: z.string(), confirmar: z.boolean().default(false) }),
      execute: async ({ para, assunto, corpo, confirmar }) => {
        if (!confirmar) return { requer_confirmacao: true, acao: "enviar_email", proposta: { para, assunto, corpo } };
        const token = await getAccessToken("google", userId);
        if (!token) return { erro: "Google não conectado" };
        const r = await sendEmail(token, para, assunto, corpo);
        return { enviado: true, id: r.id, para, assunto };
      },
    });
    tools.listar_eventos = tool({
      description: "Lista os próximos eventos da Google Agenda do usuário.",
      inputSchema: z.object({ quantidade: z.number().int().min(1).max(10).default(5) }),
      execute: async ({ quantidade }) => {
        const token = await getAccessToken("google", userId);
        if (!token) return { erro: "Google não conectado" };
        return { eventos: await listUpcomingEvents(token, quantidade) };
      },
    });
    tools.criar_evento = tool({
      description: "Cria um evento na Google Agenda. Datas em ISO 8601 com fuso (ex: 2026-07-20T15:00:00-03:00). Ação com efeito: só com confirmar=true após o usuário aprovar. Sem confirmar, devolve a proposta.",
      inputSchema: z.object({
        titulo: z.string(),
        inicio: z.string().describe("ISO 8601 com fuso"),
        fim: z.string().describe("ISO 8601 com fuso"),
        descricao: z.string().optional(),
        local: z.string().optional(),
        confirmar: z.boolean().default(false),
      }),
      execute: async ({ titulo, inicio, fim, descricao, local, confirmar }) => {
        if (!confirmar) return { requer_confirmacao: true, acao: "criar_evento", proposta: { titulo, inicio, fim, local } };
        const token = await getAccessToken("google", userId);
        if (!token) return { erro: "Google não conectado" };
        const e = await createEvent(token, { summary: titulo, startISO: inicio, endISO: fim, description: descricao, location: local });
        return { criado: true, id: e.id, link: e.htmlLink };
      },
    });
  }

  if (connected.has("notion")) {
    tools.buscar_notion = tool({
      description: "Busca páginas no Notion do usuário por texto.",
      inputSchema: z.object({ consulta: z.string(), quantidade: z.number().int().min(1).max(10).default(5) }),
      execute: async ({ consulta, quantidade }) => {
        const token = await getAccessToken("notion", userId);
        if (!token) return { erro: "Notion não conectado" };
        return { paginas: await searchNotion(token, consulta, quantidade) };
      },
    });
    tools.ler_pagina_notion = tool({
      description: "Lê o conteúdo de texto de uma página do Notion pelo id (obtido em buscar_notion).",
      inputSchema: z.object({ pagina_id: z.string() }),
      execute: async ({ pagina_id }) => {
        const token = await getAccessToken("notion", userId);
        if (!token) return { erro: "Notion não conectado" };
        return { conteudo: await readNotionPage(token, pagina_id) };
      },
    });
  }

  if (connected.has("slack")) {
    tools.listar_canais_slack = tool({
      description: "Lista os canais públicos do Slack do usuário (id + nome).",
      inputSchema: z.object({}),
      execute: async () => {
        const token = await getAccessToken("slack", userId);
        if (!token) return { erro: "Slack não conectado" };
        return { canais: await listChannels(token) };
      },
    });
    tools.enviar_slack = tool({
      description: "Posta uma mensagem num canal do Slack (use o id do canal de listar_canais_slack). Ação com efeito: só com confirmar=true após o usuário aprovar. Sem confirmar, devolve a proposta.",
      inputSchema: z.object({ canal: z.string(), texto: z.string(), confirmar: z.boolean().default(false) }),
      execute: async ({ canal, texto, confirmar }) => {
        if (!confirmar) return { requer_confirmacao: true, acao: "enviar_slack", proposta: { canal, texto } };
        const token = await getAccessToken("slack", userId);
        if (!token) return { erro: "Slack não conectado" };
        const r = await postMessage(token, canal, texto);
        return { enviado: true, ts: r.ts };
      },
    });
  }

  if (whatsappConfigured()) {
    tools.enviar_whatsapp = tool({
      description: "Envia uma mensagem de WhatsApp (número no formato internacional, ex: 5511999998888). Ação com efeito: só com confirmar=true após o usuário aprovar. Sem confirmar, devolve a proposta.",
      inputSchema: z.object({ para: z.string(), texto: z.string(), confirmar: z.boolean().default(false) }),
      execute: async ({ para, texto, confirmar }) => {
        if (!confirmar) return { requer_confirmacao: true, acao: "enviar_whatsapp", proposta: { para, texto } };
        const r = await sendWhatsApp(para, texto);
        return { enviado: true, id: r.id };
      },
    });
  }

  return tools;
}
