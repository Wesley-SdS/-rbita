import { z } from "zod";
import { getAccessToken } from "../../connectors/store";
import { listRecentEmails, createDraft, sendEmail, listUpcomingEvents, createEvent } from "../../connectors/google";
import { registerTools, type ToolDef } from "../registry";

/**
 * Domínio: Google (Gmail + Agenda). Só entram no ToolSet com o conector ligado.
 * `enviar_email` e `criar_evento` são `efeito_externo`: o registro os manda
 * para a fila de aprovação; o `run` só acontece em POST /api/actions.
 */
async function token(userId: string): Promise<string> {
  const t = await getAccessToken("google", userId);
  if (!t) throw new Error("Google não conectado");
  return t;
}

export const ler_emails: ToolDef<z.ZodObject<{ consulta: z.ZodOptional<z.ZodString>; quantidade: z.ZodDefault<z.ZodNumber> }>> = {
  name: "ler_emails",
  domain: "gmail",
  description: "Lê os e-mails recentes da caixa de entrada do Gmail do usuário. Use `consulta` para filtrar (sintaxe do Gmail, ex: 'from:cliente is:unread').",
  risk: "leitura",
  keywords: ["email", "e-mail", "gmail", "caixa de entrada", "mensagem", "chegou", "não lido"],
  requires: { connector: "google" },
  inputSchema: z.object({ consulta: z.string().optional(), quantidade: z.number().int().min(1).max(10).default(5) }),
  run: async ({ consulta, quantidade }, { userId }) => {
    const t = await getAccessToken("google", userId);
    if (!t) return { erro: "Google não conectado" };
    return { emails: await listRecentEmails(t, quantidade, consulta || "in:inbox") };
  },
};

const EmailInput = z.object({ para: z.string(), assunto: z.string(), corpo: z.string() });

export const rascunhar_email: ToolDef<typeof EmailInput> = {
  name: "rascunhar_email",
  domain: "gmail",
  description: "Cria um RASCUNHO de e-mail no Gmail (não envia). Ação segura para revisão.",
  risk: "escrita",
  keywords: ["rascunho", "email", "e-mail", "escrever", "redigir"],
  requires: { connector: "google" },
  inputSchema: EmailInput,
  run: async ({ para, assunto, corpo }, { userId }) => {
    const t = await getAccessToken("google", userId);
    if (!t) return { erro: "Google não conectado" };
    const d = await createDraft(t, para, assunto, corpo);
    return { rascunho_criado: true, id: d.id, para, assunto };
  },
};

export const enviar_email: ToolDef<typeof EmailInput> = {
  name: "enviar_email",
  domain: "gmail",
  description: "Propõe o ENVIO de um e-mail pelo Gmail. Não envia direto: cria uma proposta que o usuário aprova no painel 'Ações a confirmar'. Informe ao usuário que a proposta foi criada.",
  risk: "efeito_externo",
  keywords: ["enviar", "email", "e-mail", "mandar", "responder"],
  requires: { connector: "google" },
  inputSchema: EmailInput,
  summarize: ({ para, assunto }) => `Enviar e-mail para ${para}: "${assunto}"`,
  run: async ({ para, assunto, corpo }, { userId }) => {
    const r = await sendEmail(await token(userId), para, assunto, corpo);
    return `E-mail enviado (id ${r.id}).`;
  },
};

export const listar_eventos: ToolDef<z.ZodObject<{ quantidade: z.ZodDefault<z.ZodNumber> }>> = {
  name: "listar_eventos",
  domain: "agenda",
  description: "Lista os próximos eventos da Google Agenda do usuário.",
  risk: "leitura",
  keywords: ["agenda", "evento", "reunião", "compromisso", "calendário", "próximos", "amanhã"],
  requires: { connector: "google" },
  inputSchema: z.object({ quantidade: z.number().int().min(1).max(10).default(5) }),
  run: async ({ quantidade }, { userId }) => {
    const t = await getAccessToken("google", userId);
    if (!t) return { erro: "Google não conectado" };
    return { eventos: await listUpcomingEvents(t, quantidade) };
  },
};

const EventoInput = z.object({
  titulo: z.string(),
  inicio: z.string().describe("ISO 8601 com fuso"),
  fim: z.string().describe("ISO 8601 com fuso"),
  descricao: z.string().optional(),
  local: z.string().optional(),
});

export const criar_evento: ToolDef<typeof EventoInput> = {
  name: "criar_evento",
  domain: "agenda",
  description: "Propõe a criação de um evento na Google Agenda. Datas em ISO 8601 com fuso (ex: 2026-07-20T15:00:00-03:00). Não cria direto: enfileira uma proposta para o usuário aprovar no painel 'Ações a confirmar'.",
  risk: "efeito_externo",
  keywords: ["agendar", "marcar", "evento", "reunião", "agenda", "calendário"],
  requires: { connector: "google" },
  inputSchema: EventoInput,
  summarize: ({ titulo, inicio }) => `Criar evento "${titulo}" em ${inicio}`,
  run: async ({ titulo, inicio, fim, descricao, local }, { userId }) => {
    const e = await createEvent(await token(userId), { summary: titulo, startISO: inicio, endISO: fim, description: descricao, location: local });
    return `Evento criado: ${e.htmlLink}`;
  },
};

registerTools([ler_emails, rascunhar_email, enviar_email, listar_eventos, criar_evento]);
