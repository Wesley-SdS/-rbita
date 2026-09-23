import { z } from "zod";
import { contaParaEscrever, lerDeTodasAsContas } from "../../connectors/multi";
import { listRecentMessages, createDraftMail, sendMail, listUpcomingEvents, createCalendarEvent } from "../../connectors/microsoft";
import { registerTools, type ToolDef } from "../registry";

/**
 * Domínio: Outlook (e-mail e agenda da Microsoft).
 *
 * Existe separado do Teams porque são coisas diferentes para quem pede, mesmo
 * saindo do mesmo conector: "manda um e-mail" e "manda no Teams" não são o
 * mesmo pedido, e a `description` é o que faz o modelo escolher certo.
 *
 * Nomes com prefixo `outlook_` de propósito: `ler_emails` já é do Gmail, e
 * quem tem os dois precisa conseguir dizer qual. Sem o prefixo, o modelo
 * escolheria por sorte, e a pessoa descobriria pelo e-mail que saiu da conta
 * errada.
 *
 * Multi-conta segue a regra de `connectors/multi.ts`: ler varre todas as
 * contas Microsoft, escrever usa uma só.
 */

const CONTA = z.string().optional().describe("qual conta usar (ex.: 'trabalho'); vazio usa a principal");

async function escrever(userId: string, conta?: string) {
  const r = await contaParaEscrever("microsoft", userId, conta);
  if ("erro" in r) throw new Error(r.contas?.length ? `${r.erro} Contas: ${r.contas.join(", ")}.` : r.erro);
  return r;
}

export const outlook_ler_emails: ToolDef<z.ZodObject<{ busca: z.ZodOptional<z.ZodString>; quantidade: z.ZodDefault<z.ZodNumber> }>> = {
  name: "outlook_ler_emails",
  domain: "outlook",
  description:
    "Lê os e-mails recentes da caixa de entrada do Outlook (Microsoft), de todas as contas conectadas. Use para e-mail corporativo. Para Gmail, use `ler_emails`.",
  risk: "leitura",
  keywords: ["outlook", "email", "e-mail", "corporativo", "trabalho", "caixa de entrada", "microsoft"],
  requires: { connector: "microsoft" },
  inputSchema: z.object({ busca: z.string().optional(), quantidade: z.number().int().min(1).max(10).default(5) }),
  run: async ({ busca, quantidade }, { userId }) => {
    const r = await lerDeTodasAsContas("microsoft", userId, (t) => listRecentMessages(t, quantidade, busca));
    if (r.contas === 0) return { erro: "Microsoft não conectado" };
    return { emails: r.itens, contas_lidas: r.contas, contas_que_falharam: r.falhas };
  },
};

const EmailInput = z.object({ para: z.string(), assunto: z.string(), corpo: z.string(), conta: CONTA });

export const outlook_rascunhar_email: ToolDef<typeof EmailInput> = {
  name: "outlook_rascunhar_email",
  domain: "outlook",
  description: "Cria um RASCUNHO de e-mail no Outlook (não envia). Ação segura para revisão.",
  risk: "escrita",
  keywords: ["outlook", "rascunho", "email", "e-mail", "escrever", "redigir"],
  requires: { connector: "microsoft" },
  inputSchema: EmailInput,
  run: async ({ para, assunto, corpo, conta }, { userId }) => {
    const { token, rotulo } = await escrever(userId, conta);
    const d = await createDraftMail(token, para, assunto, corpo);
    return { rascunho_criado: true, id: d.id, para, assunto, conta: rotulo };
  },
};

export const outlook_enviar_email: ToolDef<typeof EmailInput> = {
  name: "outlook_enviar_email",
  domain: "outlook",
  description:
    "Propõe o ENVIO de um e-mail pelo Outlook. Não envia direto: cria uma proposta que o usuário aprova no painel 'Ações a confirmar'. Informe ao usuário que a proposta foi criada.",
  risk: "efeito_externo",
  keywords: ["outlook", "enviar", "email", "e-mail", "mandar", "responder", "trabalho"],
  requires: { connector: "microsoft" },
  inputSchema: EmailInput,
  summarize: ({ para, assunto, conta }) => `Enviar e-mail pelo Outlook para ${para}: "${assunto}"${conta ? ` (conta: ${conta})` : ""}`,
  run: async ({ para, assunto, corpo, conta }, { userId }) => {
    const { token, rotulo } = await escrever(userId, conta);
    await sendMail(token, para, assunto, corpo);
    // o Graph responde 202 sem id: dizer "enviado" é o máximo que dá para
    // afirmar com honestidade
    return `E-mail enviado pelo Outlook, conta ${rotulo}.`;
  },
};

export const outlook_listar_eventos: ToolDef<z.ZodObject<{ quantidade: z.ZodDefault<z.ZodNumber> }>> = {
  name: "outlook_listar_eventos",
  domain: "outlook",
  description: "Lista os próximos compromissos da agenda do Outlook, de todas as contas conectadas. Para a Google Agenda, use `listar_eventos`.",
  risk: "leitura",
  keywords: ["outlook", "agenda", "compromisso", "reunião", "calendário", "próximos", "trabalho"],
  requires: { connector: "microsoft" },
  inputSchema: z.object({ quantidade: z.number().int().min(1).max(10).default(5) }),
  run: async ({ quantidade }, { userId }) => {
    const r = await lerDeTodasAsContas("microsoft", userId, (t) => listUpcomingEvents(t, quantidade));
    if (r.contas === 0) return { erro: "Microsoft não conectado" };
    return { eventos: r.itens, contas_lidas: r.contas, contas_que_falharam: r.falhas };
  },
};

const EventoInput = z.object({
  titulo: z.string(),
  inicio: z.string().describe("ISO 8601 com fuso"),
  fim: z.string().describe("ISO 8601 com fuso"),
  descricao: z.string().optional(),
  local: z.string().optional(),
  conta: CONTA,
});

export const outlook_criar_evento: ToolDef<typeof EventoInput> = {
  name: "outlook_criar_evento",
  domain: "outlook",
  description:
    "Propõe a criação de um compromisso na agenda do Outlook. Datas em ISO 8601 com fuso (ex: 2026-07-20T15:00:00-03:00). Não cria direto: enfileira uma proposta para o usuário aprovar.",
  risk: "efeito_externo",
  keywords: ["outlook", "agendar", "marcar", "compromisso", "reunião", "agenda", "trabalho"],
  requires: { connector: "microsoft" },
  inputSchema: EventoInput,
  summarize: ({ titulo, inicio, conta }) => `Criar compromisso no Outlook "${titulo}" em ${inicio}${conta ? ` (conta: ${conta})` : ""}`,
  run: async ({ titulo, inicio, fim, descricao, local, conta }, { userId }) => {
    const { token, rotulo } = await escrever(userId, conta);
    const e = await createCalendarEvent(token, { summary: titulo, startISO: inicio, endISO: fim, description: descricao, location: local });
    return `Compromisso criado na agenda de ${rotulo}${e.link ? `: ${e.link}` : "."}`;
  },
};

registerTools([outlook_ler_emails, outlook_rascunhar_email, outlook_enviar_email, outlook_listar_eventos, outlook_criar_evento]);
