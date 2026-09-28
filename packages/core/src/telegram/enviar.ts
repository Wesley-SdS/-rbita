import { and, asc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { conversation, message } from "@orbita/db/chat-schema";
import type { TgContato } from "@orbita/db/telegram-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { paraNotaDeVoz, sintetizarFala } from "../voice/sintetizar";
import { agoraLocal, noSilencio } from "../whatsapp/horario";
import { mandarTexto, mandarVoz, type Botao } from "./api";
import * as store from "./store";
import { botoesDaProposta } from "./traduzir";

/**
 * TODA saída do Telegram passa por aqui: texto, nota de voz, aviso e proposta
 * com botão. Assim o que a Órbita manda fica gravado (a conversa tem as duas
 * pontas) e ninguém chama a API direto.
 */

async function tokenDoDono(userId: string): Promise<string> {
  const bot = await store.botDe(userId);
  if (!bot) throw new Error("O Telegram não está conectado.");
  return store.tokenDo(bot);
}

export async function mandarTextoPara(userId: string, contato: Pick<TgContato, "id" | "telegramId">, texto: string, botoes?: Botao[][]): Promise<number> {
  const token = await tokenDoDono(userId);
  const m = await mandarTexto(token, contato.telegramId, texto, botoes);
  await store.registrarSaida(userId, contato.id, contato.telegramId, String(m.message_id), "texto", texto).catch(() => undefined);
  return m.message_id;
}

/** Nota de voz com a MESMA voz da conversa em tempo real (como no WhatsApp). Sem conversão, vai como áudio comum. */
export async function mandarVozPara(userId: string, contato: Pick<TgContato, "id" | "telegramId">, texto: string): Promise<number> {
  const token = await tokenDoDono(userId);
  const voz = await settings.getMany(["whatsapp.vozDaNota", "realtime.geminiVoice"]);
  const fala = await sintetizarFala(texto, { userId, preferirGemini: voz["whatsapp.vozDaNota"] === "igual_tempo_real", vozGemini: voz["realtime.geminiVoice"] });
  let audio: { bytes: Uint8Array; mime: string } = fala;
  try {
    audio = await paraNotaDeVoz(fala);
  } catch (e) {
    log.warn("telegram.nota_de_voz_sem_conversao", { erro: e instanceof Error ? e.message : String(e) });
  }
  const m = await mandarVoz(token, contato.telegramId, audio.bytes, audio.mime);
  // o que foi DITO fica como texto da mensagem: "o que a Órbita mandou para a Anna?" tem resposta
  await store.registrarSaida(userId, contato.id, contato.telegramId, String(m.message_id), "audio", texto).catch(() => undefined);
  return m.message_id;
}

/**
 * Resposta no formato escolhido (`telegram.respostaFormato`). Nunca lança: a
 * falha de responder não pode disparar o turno de novo. O áudio pode falhar
 * (serviço de voz fora) onde o texto não falha.
 */
export async function responder(userId: string, contato: Pick<TgContato, "id" | "telegramId">, texto: string, recebidoEmAudio: boolean): Promise<void> {
  const formato = await settings.get("telegram.respostaFormato").catch(() => "espelhar");
  const emAudio = formato === "audio" || (formato === "espelhar" && recebidoEmAudio);
  try {
    if (emAudio) await mandarVozPara(userId, contato, texto);
    else await mandarTextoPara(userId, contato, texto);
  } catch (e) {
    log.error("telegram.resposta_falhou", { erro: e instanceof Error ? e.message : String(e) });
    if (emAudio) await mandarTextoPara(userId, contato, texto).catch(() => undefined);
  }
}

/** Proposta com botões para o DONO. Risco perigoso não ganha botão: só sai pela tela (decisão 9.5). */
export async function mandarProposta(userId: string, dono: Pick<TgContato, "id" | "telegramId">, proposta: { id: string; resumo: string; perigosa: boolean }, quemPediu?: string | null): Promise<void> {
  const cabeca = quemPediu ? `${quemPediu} pediu pelo Telegram:\n` : "Proposta:\n";
  if (proposta.perigosa) {
    await mandarTextoPara(userId, dono, `${cabeca}${proposta.resumo}\n\nIsto só se aprova pela tela, em Ações a confirmar.`);
    return;
  }
  await mandarTextoPara(userId, dono, `${cabeca}${proposta.resumo}`, botoesDaProposta(proposta.id));
}

// ── a Órbita tomando a iniciativa ──

const enviadosNaHora = new Map<string, { hora: string; n: number }>();

export type ResultadoDoAviso = "enviado" | "desligado" | "sem_telegram" | "silencio" | "teto" | "falhou";

/**
 * O aviso que ela já gerava (push, lista, WhatsApp) chega também no Telegram
 * do dono. Mesmas travas do WhatsApp: horário de silêncio e teto por hora.
 * Nunca lança: aviso é fail-soft.
 */
export async function avisarNoTelegram(userId: string, titulo: string, corpo: string, opts: { furaSilencio?: boolean; tipo?: "aviso" | "briefing" } = {}): Promise<ResultadoDoAviso> {
  try {
    const tipo = opts.tipo ?? "aviso";
    const cfg = await settings.getMany(["telegram.avisos", "telegram.avisosSilencio", "telegram.avisosPorHora", "connectors.fusoHorario"]);
    if (tipo === "aviso" && cfg["telegram.avisos"] !== "todos") return "desligado";
    const [bot, dono] = await Promise.all([store.botDe(userId), store.donoNoTelegram(userId)]);
    if (!bot || !dono) return "sem_telegram";

    const agora = agoraLocal(new Date(), cfg["connectors.fusoHorario"]);
    if (tipo === "aviso" && !opts.furaSilencio && noSilencio(cfg["telegram.avisosSilencio"], agora.minutos)) return "silencio";
    const hora = `${agora.dia}T${Math.floor(agora.minutos / 60)}`;
    const conta = enviadosNaHora.get(userId);
    const n = conta?.hora === hora ? conta.n : 0;
    if (tipo === "aviso" && n >= cfg["telegram.avisosPorHora"]) return "teto";
    if (tipo === "aviso") enviadosNaHora.set(userId, { hora, n: n + 1 });

    const texto = titulo.trim() ? `${titulo.trim()}\n${corpo.trim()}` : corpo.trim();
    await mandarTextoPara(userId, dono, texto.slice(0, 4000));
    // no histórico da conversa do dono como DADO: "o que você me avisou?" tem
    // resposta, e o texto do aviso (que pode citar e-mail de terceiro) não vira pedido
    await registrarAvisoNoHistorico(userId, tipo, texto).catch(() => undefined);
    return "enviado";
  } catch (e) {
    log.warn("telegram.aviso_falhou", { erro: e instanceof Error ? e.message : String(e) });
    return "falhou";
  }
}

/** Só para testes. */
export function _zerarTeto(): void {
  enviadosNaHora.clear();
}

// ── as conversas (histórico do modelo) ──

/**
 * Uma conversa por pessoa: a do dono se chama "Telegram"; a da Anna,
 * "Telegram · Anna". Separadas de propósito: o histórico de uma não pode
 * vazar no turno da outra.
 */
export async function conversaDoContato(userId: string, contato: Pick<TgContato, "papel" | "nome">): Promise<string> {
  const titulo = contato.papel === "dono" ? "Telegram" : `Telegram · ${(contato.nome ?? "pessoa").slice(0, 60)}`;
  const [c] = await db.select({ id: conversation.id }).from(conversation).where(and(eq(conversation.userId, userId), eq(conversation.title, titulo))).orderBy(asc(conversation.createdAt)).limit(1);
  if (c) return c.id;
  const [nova] = await db.insert(conversation).values({ userId, title: titulo, modelKey: "auto" }).returning({ id: conversation.id });
  return nova.id;
}

async function registrarAvisoNoHistorico(userId: string, tipo: "aviso" | "briefing", texto: string): Promise<void> {
  const convId = await conversaDoContato(userId, { papel: "dono", nome: null });
  const limpo = texto.replace(/<\/?dado_externo[^>]*>/gi, "");
  await db.insert(message).values({ conversationId: convId, role: "assistant", content: `(${tipo} que a Órbita mandou por conta própria)\n<dado_externo origem="${tipo}">\n${limpo}\n</dado_externo>` });
}
