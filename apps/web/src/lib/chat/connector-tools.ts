import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionQueue } from "@/lib/db/action-schema";
import { getAccessToken, connectedProviders } from "@/lib/connectors/store";
import { listRecentEmails, createDraft, listUpcomingEvents } from "@/lib/connectors/google";
import { searchNotion, readNotionPage } from "@/lib/connectors/notion";
import { listChannels } from "@/lib/connectors/slack";
import { whatsappConfigured } from "@/lib/connectors/whatsapp";

/**
 * Enfileira uma ação com efeito colateral para APROVAÇÃO HUMANA (não executa).
 * O LLM nunca dispara e-mail/evento/mensagem direto — cria uma proposta que o
 * usuário confirma na UI (gate contra prompt-injection).
 */
async function enqueue(userId: string, kind: string, summary: string, payload: Record<string, unknown>) {
  const [row] = await db.insert(actionQueue).values({ userId, kind, summary, payload }).returning({ id: actionQueue.id });
  return { proposta_enfileirada: true, aguardando_aprovacao: true, id: row?.id, resumo: summary };
}

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
      description: "Propõe o ENVIO de um e-mail pelo Gmail. Não envia direto: cria uma proposta que o usuário aprova no painel 'Ações a confirmar'. Informe ao usuário que a proposta foi criada.",
      inputSchema: z.object({ para: z.string(), assunto: z.string(), corpo: z.string() }),
      execute: async ({ para, assunto, corpo }) =>
        enqueue(userId, "enviar_email", `Enviar e-mail para ${para}: "${assunto}"`, { para, assunto, corpo }),
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
      description: "Propõe a criação de um evento na Google Agenda. Datas em ISO 8601 com fuso (ex: 2026-07-20T15:00:00-03:00). Não cria direto: enfileira uma proposta para o usuário aprovar no painel 'Ações a confirmar'.",
      inputSchema: z.object({
        titulo: z.string(),
        inicio: z.string().describe("ISO 8601 com fuso"),
        fim: z.string().describe("ISO 8601 com fuso"),
        descricao: z.string().optional(),
        local: z.string().optional(),
      }),
      execute: async ({ titulo, inicio, fim, descricao, local }) =>
        enqueue(userId, "criar_evento", `Criar evento "${titulo}" em ${inicio}`, { titulo, inicio, fim, descricao, local }),
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
      description: "Propõe postar uma mensagem num canal do Slack (id do canal de listar_canais_slack). Não posta direto: enfileira uma proposta para o usuário aprovar no painel 'Ações a confirmar'.",
      inputSchema: z.object({ canal: z.string(), texto: z.string() }),
      execute: async ({ canal, texto }) =>
        enqueue(userId, "enviar_slack", `Postar no Slack (${canal}): "${texto.slice(0, 60)}"`, { canal, texto }),
    });
  }

  if (whatsappConfigured()) {
    tools.enviar_whatsapp = tool({
      description: "Propõe enviar uma mensagem de WhatsApp (número internacional, ex: 5511999998888). Não envia direto: enfileira uma proposta para o usuário aprovar no painel 'Ações a confirmar'.",
      inputSchema: z.object({ para: z.string(), texto: z.string() }),
      execute: async ({ para, texto }) =>
        enqueue(userId, "enviar_whatsapp", `Enviar WhatsApp para ${para}: "${texto.slice(0, 60)}"`, { para, texto }),
    });
  }

  return tools;
}
