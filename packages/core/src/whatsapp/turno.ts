import { and, asc, desc, eq, gte } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { db } from "@orbita/db";
import { conversation, message } from "@orbita/db/chat-schema";
import { actionQueue } from "@orbita/db/action-schema";
import type { WaMensagem } from "@orbita/db/whatsapp-schema";
import { settings } from "../settings";
import { applyLlmSettings } from "../settings/apply";
import { log } from "../observability/logger";
import { gerarTexto } from "../llm/gerar";
import { FLUXO } from "../usage/registrar";
import { buildAllTools, buildPersonaContext, buildTemporalContext, SYSTEM_PROMPT } from "../chat/tools";
import { retrieveContext } from "../rag/retrieve";
import { narrateSnapshot } from "../cameras/narrate";
import { aprovarPorFrase } from "../actions/por-frase";
import { enviarAudio, enviarTexto } from "./enviar";
import { lerMidia } from "./midia";

/**
 * A conversa "Eu" (PRD-WHATSAPP W5 e W6): o dono manda mensagem para ele mesmo
 * e a Órbita responde ali, com o mesmo cérebro do chat do app.
 *
 * Por que não extrair o turno do `routes/chat.ts`: ele é stream, failover no
 * meio do stream, NDJSON e pedido de câmera, tudo preso ao HTTP. Mexer ali para
 * servir o WhatsApp arriscaria o caminho crítico do app inteiro. Aqui o turno é
 * montado com as MESMAS peças (SYSTEM_PROMPT, persona, RAG, tools com seleção
 * por relevância, a política de modelos de `gerarTexto`), sem stream.
 */

const DONO = async () => ({ personId: null, name: null, role: "dono" as const, via: "conta" as const });

const SUFIXO_WHATSAPP =
  "\n\nVocê está falando com o dono pelo WhatsApp, na conversa dele com ele mesmo. Responda curto e direto, como numa conversa de WhatsApp, sem títulos nem tabelas. " +
  "Quando propuser enviar uma mensagem a alguém, mostre o texto exato que vai sair; o dono aprova respondendo *manda* ou desiste com *cancela*.";

/** A conversa "WhatsApp" do app, onde o histórico deste canal fica (e aparece na tela). */
async function conversaDoCanal(userId: string): Promise<string> {
  const [c] = await db.select({ id: conversation.id }).from(conversation).where(and(eq(conversation.userId, userId), eq(conversation.title, "WhatsApp"))).orderBy(asc(conversation.createdAt)).limit(1);
  if (c) return c.id;
  const [nova] = await db.insert(conversation).values({ userId, title: "WhatsApp", modelKey: "auto" }).returning({ id: conversation.id });
  return nova.id;
}

/** O que o dono mandou, em texto: o áudio já chega transcrito; a imagem é descrita. */
async function pedidoDe(userId: string, m: WaMensagem): Promise<string> {
  if (m.tipo === "audio") return m.transcricao?.trim() || "";
  if (m.tipo === "imagem" && m.midiaCaminho) {
    const bytes = await lerMidia(m.midiaCaminho);
    const dataUrl = `data:${m.midiaMime ?? "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
    const descricao = await narrateSnapshot(dataUrl, "Descreva esta imagem com detalhes úteis, transcrevendo textos e valores visíveis.", { userId }).catch(() => "");
    return `[o dono mandou uma imagem, id=${m.id}${descricao ? `: ${descricao}` : ""}]` + (m.texto ? `\n${m.texto}` : "");
  }
  return m.texto?.trim() || "";
}

/**
 * Responde ao dono no chat dele, no formato escolhido. Nunca lança: a falha de
 * mandar a resposta não pode voltar a disparar o turno.
 */
async function responder(userId: string, meuJid: string, texto: string, recebidoEmAudio: boolean): Promise<void> {
  const formato = await settings.get("whatsapp.respostaFormato");
  const emAudio = formato === "audio" || (formato === "espelhar" && recebidoEmAudio);
  try {
    // a conversa "Eu" é do próprio dono: aprovação humana por definição
    if (emAudio) await enviarAudio(userId, meuJid, texto, { aprovacaoHumana: true });
    else await enviarTexto(userId, meuJid, texto, { aprovacaoHumana: true });
  } catch (e) {
    log.error("whatsapp.resposta_ao_dono_falhou", { erro: e instanceof Error ? e.message : String(e) });
    // o áudio pode falhar (serviço de voz fora) onde o texto não falha
    if (emAudio) await enviarTexto(userId, meuJid, texto, { aprovacaoHumana: true }).catch(() => undefined);
  }
}

export async function turnoDoDono(userId: string, meuJid: string, m: WaMensagem): Promise<void> {
  const pedido = await pedidoDe(userId, m);
  if (!pedido) return;
  const recebidoEmAudio = m.tipo === "audio";

  const aprovacao = await aprovarPorFrase(userId, "whatsapp", pedido);
  if (aprovacao) return responder(userId, meuJid, aprovacao, recebidoEmAudio);

  const cfg = await settings.getMany(["whatsapp.historicoConversa", "chat.maxSteps", "chat.ragTimeoutMs", "rag.topK"]);
  await applyLlmSettings();
  const convId = await conversaDoCanal(userId);
  const historico = cfg["whatsapp.historicoConversa"]
    ? (await db.select({ role: message.role, content: message.content }).from(message).where(eq(message.conversationId, convId)).orderBy(desc(message.createdAt)).limit(cfg["whatsapp.historicoConversa"])).reverse()
    : [];
  await db.insert(message).values({ conversationId: convId, role: "user", content: pedido });

  const inicio = new Date();
  const [persona, rag, ferramentas] = await Promise.all([
    buildPersonaContext(userId).catch(() => ""),
    Promise.race([retrieveContext(userId, pedido, cfg["rag.topK"]).catch(() => []), new Promise<[]>((r) => setTimeout(() => r([]), cfg["chat.ragTimeoutMs"]))]),
    buildAllTools(userId, pedido, DONO, undefined, undefined, { canal: "whatsapp" }),
  ]);
  const contexto = rag.length ? "\n\nContexto do usuário (use quando relevante e cite a fonte entre colchetes):\n" + rag.map((h, i) => `[${i + 1}] (${h.source}) ${h.content}`).join("\n\n") : "";
  const mensagens: ModelMessage[] = [...historico.map((h) => ({ role: h.role, content: h.content }) as ModelMessage), { role: "user", content: pedido }];

  let texto: string;
  try {
    const r = await gerarTexto({
      userId,
      fluxo: FLUXO.whatsapp,
      referencia: convId,
      system: SYSTEM_PROMPT + buildTemporalContext() + (persona ? "\n\n" + persona : "") + ferramentas.skillInstructions + contexto + SUFIXO_WHATSAPP,
      prompt: pedido,
      messages: mensagens,
      tools: ferramentas.tools,
      maxSteps: cfg["chat.maxSteps"],
    });
    texto = r.texto || "Pronto.";
  } catch (e) {
    log.error("whatsapp.turno_falhou", { erro: e instanceof Error ? e.message : String(e) });
    texto = "Não consegui responder agora (nenhum modelo disponível). Tente de novo em instantes.";
  } finally {
    await ferramentas.cleanup().catch(() => undefined);
  }

  // A instrução de como aprovar é do CÓDIGO, não do modelo: se o turno deixou
  // proposta para este canal, o dono sempre sabe o que responder.
  const [nova] = await db
    .select({ id: actionQueue.id })
    .from(actionQueue)
    .where(and(eq(actionQueue.userId, userId), eq(actionQueue.status, "pending"), eq(actionQueue.canal, "whatsapp"), gte(actionQueue.createdAt, inicio)))
    .limit(1);
  if (nova && !/\bmanda\b/i.test(texto)) texto += "\n\nPara enviar, responda *manda*. Para desistir, *cancela*.";

  await db.insert(message).values({ conversationId: convId, role: "assistant", content: texto });
  await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, convId));
  await responder(userId, meuJid, texto, recebidoEmAudio);
}
