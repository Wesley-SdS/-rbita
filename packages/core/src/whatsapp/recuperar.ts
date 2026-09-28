import { and, eq, inArray } from "drizzle-orm";
import { db } from "@orbita/db";
import { waMensagem } from "@orbita/db/whatsapp-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import * as ponte from "./gowa/client";
import { chatIgnorado, receberEvento } from "./processar";
import { sessaoDe } from "./sessao";
import { dataDoGowa, normalizarJid } from "./traduzir";

/**
 * Recuperar o que o webhook não entregou.
 *
 * O GOWA tenta entregar cada mensagem só cinco vezes, em segundos. Se o
 * apps/api está reiniciando nesse instante (atualização, queda, o `tsx watch`
 * recarregando), a mensagem se perde: foi assim que um pedido do dono sumiu
 * no primeiro dia com o número de verdade (27/09/2026, "connection refused").
 *
 * Mas o GOWA GUARDA o histórico de cada conversa. A cada volta, este laço
 * compara as mensagens recentes da ponte com as que a Órbita tem e passa as
 * que faltam pelo MESMO caminho do webhook (`receberEvento`), com a mesma
 * deduplicação. Só uma janela curta para trás (`whatsapp.recuperarMinutos`):
 * responder hoje a um pedido de ontem seria pior que não responder.
 */

const TIPO_DE_MIDIA: Record<string, string> = { image: "image", audio: "audio", ptt: "audio", video: "video", document: "document", sticker: "sticker" };

/** Mensagem do histórico da ponte → o evento que o webhook teria entregado. PURA. */
export function eventoDoHistorico(m: ponte.MensagemDaPonte): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: m.id,
    chat_id: m.chat_jid,
    from: m.sender_jid,
    from_name: m.sender_display_name,
    timestamp: m.timestamp,
    is_from_me: m.is_from_me === true,
  };
  const campo = m.media_type ? TIPO_DE_MIDIA[m.media_type] : undefined;
  // sem caminho local: a mídia é baixada pelo `/message/{id}/download`, o
  // caminho documentado; a legenda (se houver) vem no content
  if (campo) payload[campo] = { url: m.url, filename: m.filename, caption: m.content || undefined };
  else payload.body = m.content ?? "";
  return { event: "message", payload };
}

// até onde já olhamos, por dono (memória do processo; no boot, a janela configurada)
const olhadoAte = new Map<string, number>();

/** A hora da mensagem do histórico, do jeito que o webhook já lê (ISO, época em número ou em texto). Sem hora, zero: fica de fora. */
const instante = (t: unknown) => (t ? dataDoGowa(t, new Date(0)).getTime() : 0);

export async function recuperarPerdidas(userId: string, agora = new Date()): Promise<number> {
  const s = await sessaoDe(userId);
  if (!s || s.status !== "conectado") return 0;
  const cfg = await settings.getMany(["whatsapp.recuperarMinutos", "whatsapp.grupos", "whatsapp.status", "whatsapp.canais"]);
  const janela = agora.getTime() - cfg["whatsapp.recuperarMinutos"] * 60_000;
  // nunca antes de parear: o histórico que o celular sincroniza ao conectar
  // é passado, não pedido
  const desde = Math.max(janela, s.pareadoEm?.getTime() ?? agora.getTime(), olhadoAte.get(userId) ?? 0);
  const filtro = { grupos: cfg["whatsapp.grupos"], status: cfg["whatsapp.status"], canais: cfg["whatsapp.canais"] };

  let recuperadas = 0;
  const chats = (await ponte.listarChats(s.deviceId, 30)).filter((c) => c.ultimaMensagemEm && c.ultimaMensagemEm.getTime() > desde && !chatIgnorado(normalizarJid(c.jid), filtro));
  for (const chat of chats) {
    const recentes = (await ponte.mensagensDoChatNaPonte(s.deviceId, chat.jid, 30)).filter((m) => m.timestamp && instante(m.timestamp) > desde);
    if (!recentes.length) continue;
    const conhecidas = new Set(
      (await db.select({ id: waMensagem.externalId }).from(waMensagem).where(and(eq(waMensagem.userId, userId), inArray(waMensagem.externalId, recentes.map((m) => m.id))))).map((r) => r.id),
    );
    // da mais antiga para a mais nova: a ordem da conversa importa
    for (const m of recentes.filter((x) => !conhecidas.has(x.id)).sort((a, b) => instante(a.timestamp) - instante(b.timestamp))) {
      const r = await receberEvento(userId, s.deviceId, eventoDoHistorico(m));
      if (r.ok && r.eventoId) recuperadas++;
    }
  }
  // um minuto de sobreposição: mensagem carimbada com atraso não cai no vão
  olhadoAte.set(userId, agora.getTime() - 60_000);
  if (recuperadas) log.warn("whatsapp.recuperadas", { recuperadas });
  return recuperadas;
}

/** Só para testes. */
export function _zerarRecuperacao(): void {
  olhadoAte.clear();
}
