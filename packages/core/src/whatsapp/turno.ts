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
import { conversaDoCanal } from "./conversa";
import { embrulhar } from "./formatar";

/**
 * Os avisos automáticos entram no histórico (é o que dá sentido a "paga"), mas
 * uma manhã de avisos empurraria a conversa de verdade para fora da janela: só
 * os mais recentes ficam. PURA; recebe e devolve em ordem cronológica.
 */
export function historicoSemExcessoDeAvisos<T extends { content: string }>(msgs: readonly T[], maxAvisos: number): T[] {
  const ehAviso = (m: T) => /^\((aviso|briefing) que a Órbita mandou/.test(m.content);
  let restantes = maxAvisos;
  const out: T[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (ehAviso(msgs[i])) {
      if (restantes <= 0) continue;
      restantes--;
    }
    out.push(msgs[i]);
  }
  return out.reverse();
}
import { enqueueJob } from "../jobs/queue";

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
  "Quando o dono pedir para mandar algo a alguém, chame a ferramenta de envio JÁ, sem perguntar se pode: ela não envia, cria a proposta, e a proposta é a confirmação. Mostre o texto exato que vai sair; o dono aprova respondendo *manda* ou desiste com *cancela*. " +
  "Por aqui o dono faz TUDO que faz no app (finanças, tarefas, memória, agenda, e-mail, casa, câmeras, conhecimento): use as ferramentas como no chat. " +
  "Foto ou arquivo que ele mandar chega com um id: cupom ou nota vira gasto, extrato vira lançamentos, boleto vira conta e documento vai para o conhecimento, com usar_arquivo_whatsapp; se não estiver claro o que ele quer com o arquivo, pergunte.";

/** O que o dono mandou, em texto: o áudio já chega transcrito; a imagem é descrita. */
async function pedidoDe(userId: string, m: WaMensagem): Promise<string> {
  if (m.tipo === "audio") {
    const t = m.transcricao?.trim() || "";
    // Áudio LONGO não é comando falado: é gravação (reunião, aula, recado
    // encaminhado). Mandá-lo como pedido faria o modelo "obedecer" a uma
    // reunião inteira. Vai como arquivo, com o começo para dar contexto.
    if (t.length > (await settings.get("whatsapp.audioComoGravacaoChars"))) {
      // o começo vai EMBRULHADO: pode ser a voz de outra pessoa (recado
      // encaminhado), e não pode virar pedido nem memória do dono
      return `[o dono mandou um áudio longo, id=${m.id}, que parece uma gravação (reunião, aula, recado). Pergunte o que fazer com ele.] Começo:\n${embrulhar([t.slice(0, 400) + "…"])}`;
    }
    return t;
  }
  if (m.tipo === "imagem" && m.midiaCaminho) {
    const bytes = await lerMidia(m.midiaCaminho);
    const dataUrl = `data:${m.midiaMime ?? "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
    const descricao = await narrateSnapshot(dataUrl, "Descreva esta imagem com detalhes úteis, transcrevendo textos e valores visíveis.", { userId }).catch(() => "");
    // a descrição é do que está NA imagem (pode ser o print de uma conversa de
    // outra pessoa): vai como dado; a legenda, que o dono escreveu, vai limpa
    return `[o dono mandou uma imagem, id=${m.id}]` + (descricao ? `\n${embrulhar([descricao])}` : "") + (m.texto ? `\n${m.texto}` : "");
  }
  const legenda = m.texto?.trim() ? `\n${m.texto.trim()}` : "";
  // arquivo mandado sem pedido junto também é pedido: a Órbita pergunta o que fazer com ele
  if (m.tipo === "imagem") return `[o dono mandou uma imagem, id=${m.id}, que não pôde ser baixada]${legenda}`;
  if (m.tipo === "documento") return `[o dono mandou um documento, id=${m.id}${m.midiaMime ? `, tipo ${m.midiaMime}` : ""}]${legenda}`;
  if (m.tipo === "video") return `[o dono mandou um vídeo, id=${m.id}]${legenda}`;
  if (m.tipo === "localizacao") return `[o dono mandou uma localização]${legenda}`;
  if (m.tipo === "contato") return `[o dono mandou um contato]${legenda}`;
  if (m.tipo === "figurinha") return "";
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

  const convId = await conversaDoCanal(userId);
  // "manda" responde ao que foi proposto DEPOIS da fala anterior do dono, não
  // a qualquer proposta pendente da última meia hora
  const [anterior] = await db.select({ em: message.createdAt }).from(message).where(and(eq(message.conversationId, convId), eq(message.role, "user"))).orderBy(desc(message.createdAt)).limit(1);
  const aprovacao = await aprovarPorFrase(userId, "whatsapp", pedido, anterior?.em ?? null);
  if (aprovacao) {
    await db.insert(message).values([
      { conversationId: convId, role: "user", content: pedido },
      { conversationId: convId, role: "assistant", content: aprovacao.texto },
    ]);
    return responder(userId, meuJid, aprovacao.texto, recebidoEmAudio);
  }

  const cfg = await settings.getMany(["whatsapp.historicoConversa", "whatsapp.avisosNoHistorico", "whatsapp.ferramentas", "chat.maxSteps", "chat.ragTimeoutMs", "rag.topK", "memory.extractEnabled"]);
  await applyLlmSettings();
  const janela = cfg["whatsapp.historicoConversa"];
  // lê mais que a janela para compensar os avisos cortados, e corta depois
  const historico = janela
    ? historicoSemExcessoDeAvisos(
        (await db.select({ role: message.role, content: message.content }).from(message).where(eq(message.conversationId, convId)).orderBy(desc(message.createdAt)).limit(janela * 3)).reverse(),
        cfg["whatsapp.avisosNoHistorico"],
      ).slice(-janela)
    : [];
  await db.insert(message).values({ conversationId: convId, role: "user", content: pedido });

  const inicio = new Date();
  const [persona, rag, ferramentas] = await Promise.all([
    buildPersonaContext(userId).catch(() => ""),
    Promise.race([retrieveContext(userId, pedido, cfg["rag.topK"]).catch(() => []), new Promise<[]>((r) => setTimeout(() => r([]), cfg["chat.ragTimeoutMs"]))]),
    buildAllTools(userId, pedido, DONO, undefined, undefined, { canal: "whatsapp", todas: cfg["whatsapp.ferramentas"] === "todas" }),
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

  // A instrução de como aprovar e O QUE vai sair são do CÓDIGO, não do
  // modelo: o dono aprova o resumo gravado na fila (destino resolvido e texto
  // inteiro), nunca a paráfrase. Um texto injetado numa mensagem lida podia
  // fazer o modelo dizer "vou responder ok à Maria" enquanto a proposta real
  // ia para outro número, com outro texto.
  const novas = await db
    .select({ resumo: actionQueue.summary })
    .from(actionQueue)
    .where(and(eq(actionQueue.userId, userId), eq(actionQueue.status, "pending"), eq(actionQueue.canal, "whatsapp"), gte(actionQueue.createdAt, inicio)))
    .orderBy(asc(actionQueue.createdAt));
  if (novas.length) {
    const varias = novas.length > 1;
    const lista = novas.map((n, i) => (varias ? `${i + 1}. ` : "") + n.resumo).join("\n");
    // o resumo real vai SEMPRE; a instrução, só se o modelo não a deu (repetir cansa)
    const instrucao = /\bmanda\b/i.test(texto) && !varias ? "" : `\n\nPara enviar, responda *manda*${varias ? " 1, *manda* 2…" : ""}. Para desistir, *cancela*.`;
    texto += `\n\n${varias ? "Propostas" : "Proposta"}:\n${lista}${instrucao}`;
  }

  await db.insert(message).values({ conversationId: convId, role: "assistant", content: texto });
  await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, convId));
  // a memória aprende com o que é dito pelo WhatsApp como aprende no chat (B4.1)
  if (cfg["memory.extractEnabled"]) {
    void enqueueJob(userId, { kind: "memoria.extrair", payload: { conversationId: convId }, dedupKey: `memoria-extrair:${convId}` }).catch((e) =>
      log.warn("whatsapp.memoria_nao_enfileirada", { erro: e instanceof Error ? e.message : String(e) }),
    );
  }
  await responder(userId, meuJid, texto, recebidoEmAudio);
}
