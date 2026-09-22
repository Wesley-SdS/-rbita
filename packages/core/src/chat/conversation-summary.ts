import { generateText } from "ai";
import { asc, count, eq } from "drizzle-orm";
import { modeloDaCasa } from "../llm/gerar";
import { registrarUso, FLUXO } from "../usage/registrar";
import { db } from "@orbita/db";
import { conversation, message } from "@orbita/db/chat-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";

/**
 * RESUMO DE CONVERSA COBRINDO 100% DAS MENSAGENS (B4.2, pedido do dono).
 *
 * O chat manda para o modelo uma janela das mensagens recentes. Antes, o que
 * saía da janela sumia para sempre: a mensagem 25 de uma conversa longa não
 * existia mais para a Órbita. Agora toda mensagem está sempre num de dois
 * lugares:
 *   - na parte ainda não resumida (a janela, mais o que acabou de sair dela e
 *     o trabalho de resumo ainda não dobrou), que vai INTEIRA para o modelo;
 *   - no resumo acumulado da conversa, que vai junto no prompt.
 * Dobrar o que saiu da janela no resumo é trabalho de fila, depois do turno:
 * a resposta não espera por isso.
 */

export type Progresso = (feito: number, total: number | null, passo: string) => Promise<void>;

/**
 * Quantas mensagens dobrar no resumo agora: tudo que passou da janela.
 * Puro. `total` e `jaResumidas` são contagens na ordem (createdAt, id).
 */
export function quantasDobrar(total: number, jaResumidas: number, janela: number): number {
  return Math.max(0, total - Math.max(0, janela) - jaResumidas);
}

/**
 * De onde começa o histórico enviado neste turno (offset na ordem createdAt,
 * id). Em regime normal é logo depois do que já está no resumo: tudo que não
 * foi resumido vai inteiro. Numa conversa antiga, de antes do resumo existir, o
 * pendente pode ser enorme: aí vai o `teto` mais recente, e o trabalho de
 * resumo, enfileirado no mesmo turno, dobra o resto. Puro.
 */
export function inicioDoHistorico(total: number, jaResumidas: number, teto: number): { inicio: number; foraDoTurno: number } {
  const inicio = Math.max(jaResumidas, total - Math.max(1, teto));
  return { inicio, foraDoTurno: inicio - jaResumidas };
}

/** Bloco do prompt com o resumo. Vazio quando a conversa ainda cabe inteira na janela. */
export function blocoDoResumo(resumo: string | null | undefined): string {
  if (!resumo?.trim()) return "";
  return (
    "\n\n<resumo_da_conversa>\nO que já foi conversado ANTES das mensagens abaixo, resumido. Vale como parte da conversa: " +
    "use para lembrar pedidos, decisões, nomes e pendências.\n" +
    resumo.trim() +
    "\n</resumo_da_conversa>"
  );
}

const PROMPT_DOBRA =
  "Você mantém o RESUMO de uma conversa entre o dono e a Órbita (assistente pessoal). " +
  "Receba o resumo atual e as mensagens que acabaram de sair da janela, e escreva o resumo NOVO que junta os dois. " +
  "Guarde tudo que pode importar depois: pedidos, decisões, fatos sobre o dono e a casa, nomes, datas, números, pendências e o que ficou combinado. " +
  "Descarte cumprimento e conversa sem conteúdo. Não invente nada. Escreva em português do Brasil, em tópicos curtos, " +
  "em no máximo {max} caracteres. Responda só com o resumo.\n\n";

/**
 * Dobra no resumo tudo que passou da janela. Em lotes, gravando depois de
 * cada um: se cair no meio, a retentativa continua de onde parou em vez de
 * refazer (e sem nunca dobrar a mesma mensagem duas vezes).
 */
export async function foldConversation(conversationId: string, progresso?: Progresso): Promise<{ dobradas: number }> {
  const cfg = await settings.getMany(["chat.historyWindow", "chat.summaryBatch", "chat.summaryMaxChars", "chat.summaryModel"]);
  const [conv] = await db.select().from(conversation).where(eq(conversation.id, conversationId)).limit(1);
  if (!conv) return { dobradas: 0 };
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(message).where(eq(message.conversationId, conversationId));

  const aDobrar = quantasDobrar(Number(total), conv.summaryCount, cfg["chat.historyWindow"]);
  if (!aDobrar) return { dobradas: 0 };

  const { model, modelKey } = await modeloDaCasa(cfg["chat.summaryModel"]);
  const comecou = Date.now();
  let entrada = 0;
  let saida = 0;
  let resumo = conv.summary ?? "";
  let jaResumidas = conv.summaryCount;
  let dobradas = 0;

  while (dobradas < aDobrar) {
    const lote = Math.min(cfg["chat.summaryBatch"], aDobrar - dobradas);
    await progresso?.(dobradas, aDobrar, `resumindo mensagens ${jaResumidas + 1} a ${jaResumidas + lote}`);
    const msgs = await db
      .select({ role: message.role, content: message.content })
      .from(message)
      .where(eq(message.conversationId, conversationId))
      .orderBy(asc(message.createdAt), asc(message.id))
      .offset(jaResumidas)
      .limit(lote);
    if (!msgs.length) break;

    const trecho = msgs.map((m) => `${m.role === "user" ? "Dono" : m.role === "assistant" ? "Órbita" : "Sistema"}: ${m.content}`).join("\n\n");
    const { text, usage } = await generateText({
      model,
      prompt:
        PROMPT_DOBRA.replace("{max}", String(cfg["chat.summaryMaxChars"])) +
        `RESUMO ATUAL:\n${resumo || "(vazio, a conversa está começando)"}\n\nMENSAGENS NOVAS:\n${trecho}`,
    });
    entrada += usage?.inputTokens ?? 0;
    saida += usage?.outputTokens ?? 0;
    resumo = text.trim().slice(0, cfg["chat.summaryMaxChars"]);
    jaResumidas += msgs.length;
    dobradas += msgs.length;
    // grava a cada lote: resumo e contagem andam juntos, numa query só
    await db.update(conversation).set({ summary: resumo, summaryCount: jaResumidas }).where(eq(conversation.id, conversationId));
  }

  log.info("chat.resumo_dobrado", { conversationId, dobradas, jaResumidas });
  registrarUso({
    userId: conv.userId,
    fluxo: FLUXO.resumoConversa,
    referencia: conversationId,
    modelKey,
    consumo: { unidade: "tokens", entrada, saida },
    duracaoMs: Date.now() - comecou,
  });
  return { dobradas };
}
