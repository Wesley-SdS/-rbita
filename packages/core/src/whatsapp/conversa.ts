import { and, asc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { conversation, message } from "@orbita/db/chat-schema";

/**
 * A conversa "WhatsApp" do app: onde o histórico da conversa "Eu" fica (e
 * aparece na tela). Os avisos e o briefing entram AQUI também, como fala da
 * Órbita: é o que faz um "paga" ou "adia" do dono, logo depois de um aviso,
 * ter a que se referir.
 */
export async function conversaDoCanal(userId: string): Promise<string> {
  const [c] = await db.select({ id: conversation.id }).from(conversation).where(and(eq(conversation.userId, userId), eq(conversation.title, "WhatsApp"))).orderBy(asc(conversation.createdAt)).limit(1);
  if (c) return c.id;
  const [nova] = await db.insert(conversation).values({ userId, title: "WhatsApp", modelKey: "auto" }).returning({ id: conversation.id });
  return nova.id;
}

/**
 * Guarda no histórico o que a Órbita mandou por conta própria. O conteúdo vai
 * EMBRULHADO como dado: um aviso pode carregar texto de fora (o trecho de um
 * e-mail, o nome de quem apareceu na câmera), e o modelo o releria depois como
 * se fosse fala dele. Embrulhado, é contexto para o "paga", nunca instrução.
 */
export async function registrarNoHistorico(userId: string, tipo: "aviso" | "briefing", texto: string): Promise<void> {
  const convId = await conversaDoCanal(userId);
  const limpo = texto.replace(/<\/?dado_externo[^>]*>/gi, "");
  await db.insert(message).values({ conversationId: convId, role: "assistant", content: `(${tipo} que a Órbita mandou por conta própria)\n<dado_externo origem="${tipo}">\n${limpo}\n</dado_externo>` });
  await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, convId));
}
