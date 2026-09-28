import type { ModelMessage } from "ai";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@orbita/db";
import { conversation, message } from "@orbita/db/chat-schema";
import { actionQueue } from "@orbita/db/action-schema";
import type { TgContato, TgMensagem } from "@orbita/db/telegram-schema";
import { SYSTEM_PROMPT, buildAllTools, buildPersonaContext, buildTemporalContext } from "../chat/tools";
import { retrieveContext } from "../rag/retrieve";
import { gerarTexto } from "../llm/gerar";
import { applyLlmSettings } from "../settings/apply";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { FLUXO } from "../usage/registrar";
import { enqueueJob } from "../jobs/queue";
import { aprovarPorFrase } from "../actions/por-frase";
import { effectiveRisk, getTool, loadToolOverrides, type Requester } from "../tools/index";
import { getPerson } from "../identity/people";
import { narrateSnapshot } from "../cameras/narrate";
import { lerMidia } from "../whatsapp/midia";
import { embrulhar } from "../whatsapp/formatar";
import { conversaDoContato, mandarProposta, mandarTextoPara, responder } from "./enviar";
import * as store from "./store";

/**
 * Um turno no Telegram: o dono ou uma pessoa da casa falou com a Órbita.
 *
 * DONO: o mesmo que a conversa "Eu" do WhatsApp (todas as tools, "manda"
 * aprova, a memória aprende).
 *
 * PESSOA DA CASA (a Anna): é outra pessoa usando o assistente do dono, então
 * ela NÃO recebe o que é dele. Só os domínios liberados em
 * `telegram.dominiosDaFamilia` (casa, clima, rota…); nada de RAG (os documentos
 * do dono), persona ou memória (o que a Anna diz não vira "fato do Wesley");
 * permissão por pessoa e cômodo, como na voz; e toda ação com efeito vira
 * proposta que o DONO aprova, com a nota "pedido pelo Telegram: Anna".
 */

const SUFIXO_DONO =
  "\n\nVocê está falando com o dono pelo Telegram, no canal da própria Órbita. Responda curto e direto, como numa conversa de mensagens, sem títulos nem tabelas. " +
  "Quando o dono pedir para mandar algo a alguém, chame a ferramenta de envio JÁ, sem perguntar se pode: a proposta é a confirmação, e ele aprova no botão ou respondendo *manda*. " +
  "Por aqui o dono faz tudo que faz no app.";

const sufixoPessoa = (nome: string, dono: string) =>
  `\n\nVocê está falando pelo Telegram com ${nome}, uma pessoa da casa de ${dono}. NÃO é o dono: não fale dos e-mails, das finanças, da agenda nem de qualquer assunto pessoal de ${dono}, ` +
  "e não use o que sabe dele para responder a ela. Ajude com a casa e com o que suas ferramentas permitem. " +
  `Ações com efeito (mandar mensagem, destrancar, comprar) viram um pedido que ${dono} aprova: diga isso a ela. Responda curto, como numa conversa de mensagens.`;

/** O que a pessoa mandou, em texto: o áudio já chega transcrito; a imagem é descrita. */
async function pedidoDe(userId: string, m: TgMensagem, quem: string): Promise<string> {
  const legenda = m.texto?.trim() ? `\n${m.texto.trim()}` : "";
  if (m.tipo === "audio") return m.transcricao?.trim() || (legenda ? legenda.trim() : "");
  if (m.tipo === "imagem" && m.midiaCaminho) {
    const bytes = await lerMidia(m.midiaCaminho);
    const dataUrl = `data:${m.midiaMime ?? "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
    const descricao = await narrateSnapshot(dataUrl, "Descreva esta imagem com detalhes úteis, transcrevendo textos e valores visíveis.", { userId }).catch(() => "");
    // o que está NA imagem pode ser o print de uma conversa de outra pessoa: vai como dado
    return `[${quem} mandou uma imagem]` + (descricao ? `\n${embrulhar([descricao])}` : "") + legenda;
  }
  if (m.tipo === "imagem") return `[${quem} mandou uma imagem que não pôde ser baixada]${legenda}`;
  if (m.tipo === "documento") return `[${quem} mandou um documento${m.midiaMime ? ` (${m.midiaMime})` : ""}; pelo Telegram a Órbita ainda não lê documento: peça para mandar pelo app ou pelo WhatsApp]${legenda}`;
  if (m.tipo === "video") return `[${quem} mandou um vídeo]${legenda}`;
  if (m.tipo === "localizacao") return `[${quem} mandou a localização ${m.texto ?? ""}]`;
  if (m.tipo === "contato") return `[${quem} mandou um contato: ${m.texto ?? ""}]`;
  if (m.tipo === "figurinha") return "";
  return m.texto?.trim() || "";
}

export async function turnoDoTelegram(userId: string, contato: TgContato, m: TgMensagem): Promise<void> {
  const ehDono = contato.papel === "dono";
  const pessoa = !ehDono && contato.personId ? await getPerson(userId, contato.personId).catch(() => null) : null;
  const nome = pessoa?.name ?? contato.nome ?? "a pessoa";
  const pedido = await pedidoDe(userId, m, ehDono ? "o dono" : nome);
  if (!pedido) return;
  const recebidoEmAudio = m.tipo === "audio";
  const convId = await conversaDoContato(userId, contato);

  // "manda" do DONO aprova o que foi proposto por aqui desde a fala anterior
  // dele. A pessoa da casa nunca aprova nada: dizer "manda" é só uma frase.
  if (ehDono) {
    const [anterior] = await db.select({ em: message.createdAt }).from(message).where(and(eq(message.conversationId, convId), eq(message.role, "user"))).orderBy(desc(message.createdAt)).limit(1);
    const aprovacao = await aprovarPorFrase(userId, "telegram", pedido, anterior?.em ?? null);
    if (aprovacao) {
      await db.insert(message).values([
        { conversationId: convId, role: "user", content: pedido },
        { conversationId: convId, role: "assistant", content: aprovacao.texto },
      ]);
      return responder(userId, contato, aprovacao.texto, recebidoEmAudio);
    }
  }

  const cfg = await settings.getMany(["telegram.historicoConversa", "telegram.dominiosDaFamilia", "chat.maxSteps", "chat.ragTimeoutMs", "rag.topK", "memory.extractEnabled"]);
  await applyLlmSettings();
  const janela = cfg["telegram.historicoConversa"];
  const historico = janela
    ? (await db.select({ role: message.role, content: message.content }).from(message).where(eq(message.conversationId, convId)).orderBy(desc(message.createdAt)).limit(janela)).reverse()
    : [];
  await db.insert(message).values({ conversationId: convId, role: "user", content: pedido });

  const requester: Requester = ehDono
    ? { personId: null, name: null, role: "dono", via: "conta" }
    : { personId: pessoa?.id ?? null, name: nome, role: pessoa?.role === "visitante" ? "visitante" : "morador", via: "telegram" };
  const inicio = new Date();
  const [persona, rag, ferramentas] = await Promise.all([
    ehDono ? buildPersonaContext(userId).catch(() => "") : Promise.resolve(""),
    ehDono
      ? Promise.race([retrieveContext(userId, pedido, cfg["rag.topK"]).catch(() => []), new Promise<[]>((r) => setTimeout(() => r([]), cfg["chat.ragTimeoutMs"]))])
      : Promise.resolve([]),
    ehDono
      ? buildAllTools(userId, pedido, async () => requester, undefined, undefined, { canal: "telegram", todas: true })
      : buildAllTools(userId, pedido, async () => requester, undefined, undefined, { canal: "telegram", dominios: cfg["telegram.dominiosDaFamilia"].length ? cfg["telegram.dominiosDaFamilia"] : ["clima"] }),
  ]);
  const contexto = rag.length ? "\n\nContexto do usuário (use quando relevante e cite a fonte entre colchetes):\n" + rag.map((h, i) => `[${i + 1}] (${h.source}) ${h.content}`).join("\n\n") : "";
  const donoNome = (await settings.get("meetings.meuNome").catch(() => "")) || "o dono";
  const mensagens: ModelMessage[] = [...historico.map((h) => ({ role: h.role, content: h.content }) as ModelMessage), { role: "user", content: pedido }];

  let texto: string;
  try {
    const r = await gerarTexto({
      userId,
      fluxo: FLUXO.telegram,
      referencia: convId,
      system: SYSTEM_PROMPT + buildTemporalContext() + (persona ? "\n\n" + persona : "") + ferramentas.skillInstructions + contexto + (ehDono ? SUFIXO_DONO : sufixoPessoa(nome, donoNome)),
      prompt: pedido,
      messages: mensagens,
      tools: ferramentas.tools,
      maxSteps: cfg["chat.maxSteps"],
    });
    texto = r.texto || "Pronto.";
  } catch (e) {
    log.error("telegram.turno_falhou", { erro: e instanceof Error ? e.message : String(e) });
    texto = "Não consegui responder agora (nenhum modelo disponível). Tente de novo em instantes.";
  } finally {
    await ferramentas.cleanup().catch(() => undefined);
  }

  // O que vai ser aprovado é do CÓDIGO, não do modelo: o dono recebe o resumo
  // gravado na fila, com botão. Proposta nascida no turno da Anna vai para o
  // DONO, nunca para ela.
  const novas = await db
    .select({ id: actionQueue.id, kind: actionQueue.kind, resumo: actionQueue.summary })
    .from(actionQueue)
    .where(and(eq(actionQueue.userId, userId), eq(actionQueue.status, "pending"), eq(actionQueue.canal, "telegram"), gte(actionQueue.createdAt, inicio)))
    .orderBy(asc(actionQueue.createdAt));

  await db.insert(message).values({ conversationId: convId, role: "assistant", content: texto });
  await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, convId));
  // a memória aprende só com o DONO: o que a Anna diz não é fato sobre ele
  if (ehDono && cfg["memory.extractEnabled"]) {
    void enqueueJob(userId, { kind: "memoria.extrair", payload: { conversationId: convId }, dedupKey: `memoria-extrair:${convId}` }).catch(() => undefined);
  }
  await responder(userId, contato, texto, recebidoEmAudio);

  if (novas.length) await entregarPropostas(userId, novas, ehDono ? null : nome);
}

async function entregarPropostas(userId: string, novas: { id: string; kind: string; resumo: string }[], quemPediu: string | null): Promise<void> {
  const dono = await store.donoNoTelegram(userId);
  const overrides = await loadToolOverrides();
  const perigosa = (kind: string) => {
    const def = getTool(kind);
    return def ? effectiveRisk(def, overrides) === "perigoso" : true;
  };
  if (!dono) {
    // o dono não está no Telegram: o pedido da pessoa espera na tela, e ele é avisado
    if (quemPediu) {
      const { notifyUser } = await import("../routines/run");
      await notifyUser(userId, `${quemPediu} pediu pelo Telegram`, novas.map((n) => n.resumo).join("\n"), null, { destino: "/app" }).catch(() => undefined);
    }
    return;
  }
  for (const n of novas) await mandarProposta(userId, dono, { id: n.id, resumo: n.resumo, perigosa: perigosa(n.kind) }, quemPediu).catch((e) => log.warn("telegram.proposta_falhou", { erro: String(e).slice(0, 200) }));
}

/** Recado curto para quem não conhece a Órbita (UM por pessoa, não um por mensagem). */
export async function recadoParaDesconhecido(userId: string, contato: TgContato): Promise<void> {
  if (contato.avisadoEm) return;
  await store.marcarAvisado(contato.id);
  const recado = await settings.get("telegram.recadoDesconhecido");
  if (recado.trim()) await mandarTextoPara(userId, contato, recado.trim()).catch(() => undefined);
}
