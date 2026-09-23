import { z } from "zod";
import { contaParaEscrever, lerDeTodasAsContas } from "../../connectors/multi";
import { listRecentEmails, createDraft, sendEmail, listUpcomingEvents, createEvent } from "../../connectors/google";
import { registerTools, type ToolDef } from "../registry";

/**
 * Domínio: Google (Gmail + Agenda). Só entram no ToolSet com o conector ligado.
 * `enviar_email` e `criar_evento` são `efeito_externo`: o registro os manda
 * para a fila de aprovação; o `run` só acontece em POST /api/actions.
 *
 * Multi-conta (ver `connectors/multi.ts`): LER varre todas as contas do Google
 * e diz de qual veio cada item; ESCREVER usa uma só, a principal ou a que o
 * dono indicar. Pedido ambíguo vira pergunta, nunca palpite: mandar o e-mail
 * pela conta errada não se desfaz.
 */

/** O parâmetro que deixa o dono dizer "pela conta do trabalho". */
const CONTA = z.string().optional().describe("qual conta usar (ex.: 'trabalho', 'gmail pessoal'); vazio usa a principal");

/** A conta que escreve. Lança com a lista de opções quando o pedido é ambíguo. */
async function escrever(userId: string, conta?: string) {
  const r = await contaParaEscrever("google", userId, conta);
  if ("erro" in r) throw new Error(r.contas?.length ? `${r.erro} Contas: ${r.contas.join(", ")}.` : r.erro);
  return r;
}

export const ler_emails: ToolDef<z.ZodObject<{ consulta: z.ZodOptional<z.ZodString>; quantidade: z.ZodDefault<z.ZodNumber> }>> = {
  name: "ler_emails",
  domain: "gmail",
  description:
    "Lê os e-mails recentes da caixa de entrada do Gmail do usuário, de TODAS as contas conectadas. Use `consulta` para filtrar (sintaxe do Gmail, ex: 'from:cliente is:unread'). Cada e-mail vem marcado com a conta de origem.",
  risk: "leitura",
  keywords: ["email", "e-mail", "gmail", "caixa de entrada", "mensagem", "chegou", "não lido"],
  requires: { connector: "google" },
  inputSchema: z.object({ consulta: z.string().optional(), quantidade: z.number().int().min(1).max(10).default(5) }),
  run: async ({ consulta, quantidade }, { userId }) => {
    // todas as contas: responder "não tem nada" olhando só a pessoal, com a do
    // trabalho cheia, seria pior do que não ter multi-conta
    const r = await lerDeTodasAsContas("google", userId, (t) => listRecentEmails(t, quantidade, consulta || "in:inbox"));
    if (r.contas === 0) return { erro: "Google não conectado" };
    return { emails: r.itens, contas_lidas: r.contas, contas_que_falharam: r.falhas };
  },
};

const EmailInput = z.object({ para: z.string(), assunto: z.string(), corpo: z.string() });
const EmailComConta = EmailInput.extend({ conta: CONTA });

export const rascunhar_email: ToolDef<typeof EmailComConta> = {
  name: "rascunhar_email",
  domain: "gmail",
  description: "Cria um RASCUNHO de e-mail no Gmail (não envia). Ação segura para revisão.",
  risk: "escrita",
  keywords: ["rascunho", "email", "e-mail", "escrever", "redigir"],
  requires: { connector: "google" },
  inputSchema: EmailComConta,
  run: async ({ para, assunto, corpo, conta }, { userId }) => {
    const { token, rotulo } = await escrever(userId, conta);
    const d = await createDraft(token, para, assunto, corpo);
    // o rótulo volta sempre: o dono precisa saber em qual caixa o rascunho ficou
    return { rascunho_criado: true, id: d.id, para, assunto, conta: rotulo };
  },
};

export const enviar_email: ToolDef<typeof EmailComConta> = {
  name: "enviar_email",
  domain: "gmail",
  description:
    "Propõe o ENVIO de um e-mail pelo Gmail. Não envia direto: cria uma proposta que o usuário aprova no painel 'Ações a confirmar'. Informe ao usuário que a proposta foi criada.",
  risk: "efeito_externo",
  keywords: ["enviar", "email", "e-mail", "mandar", "responder"],
  requires: { connector: "google" },
  inputSchema: EmailComConta,
  // a conta aparece no resumo da fila: aprovar sem saber por qual conta sai
  // seria aprovar outra coisa
  summarize: ({ para, assunto, conta }) => `Enviar e-mail para ${para}: "${assunto}"${conta ? ` (conta: ${conta})` : ""}`,
  run: async ({ para, assunto, corpo, conta }, { userId }) => {
    const { token, rotulo } = await escrever(userId, conta);
    const r = await sendEmail(token, para, assunto, corpo);
    return `E-mail enviado pela conta ${rotulo} (id ${r.id}).`;
  },
};

export const listar_eventos: ToolDef<z.ZodObject<{ quantidade: z.ZodDefault<z.ZodNumber> }>> = {
  name: "listar_eventos",
  domain: "agenda",
  description: "Lista os próximos eventos da Google Agenda do usuário, de TODAS as contas conectadas.",
  risk: "leitura",
  keywords: ["agenda", "evento", "reunião", "compromisso", "calendário", "próximos", "amanhã"],
  requires: { connector: "google" },
  inputSchema: z.object({ quantidade: z.number().int().min(1).max(10).default(5) }),
  run: async ({ quantidade }, { userId }) => {
    // a agenda do trabalho e a pessoal juntas: é assim que o dia realmente é
    const r = await lerDeTodasAsContas("google", userId, (t) => listUpcomingEvents(t, quantidade));
    if (r.contas === 0) return { erro: "Google não conectado" };
    return { eventos: r.itens, contas_lidas: r.contas, contas_que_falharam: r.falhas };
  },
};

const EventoInput = z.object({
  titulo: z.string(),
  inicio: z.string().describe("ISO 8601 com fuso"),
  fim: z.string().describe("ISO 8601 com fuso"),
  descricao: z.string().optional(),
  local: z.string().optional(),
});
const EventoComConta = EventoInput.extend({ conta: CONTA });

export const criar_evento: ToolDef<typeof EventoComConta> = {
  name: "criar_evento",
  domain: "agenda",
  description:
    "Propõe a criação de um evento na Google Agenda. Datas em ISO 8601 com fuso (ex: 2026-07-20T15:00:00-03:00). Não cria direto: enfileira uma proposta para o usuário aprovar no painel 'Ações a confirmar'.",
  risk: "efeito_externo",
  keywords: ["agendar", "marcar", "evento", "reunião", "agenda", "calendário"],
  requires: { connector: "google" },
  inputSchema: EventoComConta,
  summarize: ({ titulo, inicio, conta }) => `Criar evento "${titulo}" em ${inicio}${conta ? ` (conta: ${conta})` : ""}`,
  run: async ({ titulo, inicio, fim, descricao, local, conta }, { userId }) => {
    const { token, rotulo } = await escrever(userId, conta);
    const e = await createEvent(token, { summary: titulo, startISO: inicio, endISO: fim, description: descricao, location: local });
    return `Evento criado na agenda de ${rotulo}: ${e.htmlLink}`;
  },
};

registerTools([ler_emails, rascunhar_email, enviar_email, listar_eventos, criar_evento]);
