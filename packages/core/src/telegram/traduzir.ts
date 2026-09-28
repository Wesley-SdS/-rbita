import type { TgMensagemApi } from "./api";

/**
 * O que chega do Telegram, no formato da Órbita. PURO.
 */

export type TipoTg = "texto" | "audio" | "imagem" | "documento" | "video" | "localizacao" | "contato" | "figurinha" | "outro";

export interface MensagemTraduzida {
  chatId: string;
  telegramId: string;
  messageId: string;
  nome: string | null;
  username: string | null;
  tipo: TipoTg;
  texto: string | null;
  fileId: string | null;
  mime: string | null;
  em: Date;
  /** conversa em grupo: o bot só responde em conversa privada */
  grupo: boolean;
}

export function traduzirMensagem(m: TgMensagemApi): MensagemTraduzida | null {
  if (!m.from || m.from.is_bot) return null;
  const nome = [m.from.first_name, m.from.last_name].filter(Boolean).join(" ").trim() || null;
  const base = {
    chatId: String(m.chat.id),
    telegramId: String(m.from.id),
    messageId: String(m.message_id),
    nome,
    username: m.from.username ?? null,
    em: new Date(m.date * 1000),
    grupo: m.chat.type !== "private",
  };
  const legenda = m.caption?.trim() || null;
  const voz = m.voice ?? m.audio;
  if (voz) return { ...base, tipo: "audio", texto: legenda, fileId: voz.file_id, mime: voz.mime_type ?? "audio/ogg" };
  // a foto vem em vários tamanhos: a maior é a última
  if (m.photo?.length) return { ...base, tipo: "imagem", texto: legenda, fileId: m.photo[m.photo.length - 1].file_id, mime: "image/jpeg" };
  if (m.document) return { ...base, tipo: m.document.mime_type?.startsWith("image/") ? "imagem" : "documento", texto: legenda, fileId: m.document.file_id, mime: m.document.mime_type ?? null };
  const video = m.video ?? m.video_note;
  if (video) return { ...base, tipo: "video", texto: legenda, fileId: video.file_id, mime: video.mime_type ?? "video/mp4" };
  if (m.sticker) return { ...base, tipo: "figurinha", texto: null, fileId: null, mime: null };
  if (m.location) return { ...base, tipo: "localizacao", texto: `${m.location.latitude},${m.location.longitude}`, fileId: null, mime: null };
  if (m.contact) return { ...base, tipo: "contato", texto: `${m.contact.first_name ?? ""} ${m.contact.phone_number}`.trim(), fileId: null, mime: null };
  if (m.text !== undefined) return { ...base, tipo: "texto", texto: m.text, fileId: null, mime: null };
  return { ...base, tipo: "outro", texto: null, fileId: null, mime: null };
}

/** "/start CODIGO" (o link do convite) → o código; qualquer outra coisa → null. */
export function codigoDoStart(texto: string | null): string | null {
  const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})\s*$/.exec(texto?.trim() ?? "");
  return m ? m[1] : null;
}

export type AcaoDoBotao = { acao: "aprovar" | "recusar"; propostaId: string };

/** "ap:<uuid>" / "rc:<uuid>" → o que o botão faz. Dado de botão é entrada não confiável: tudo que não casa é null. */
export function lerBotao(data: string | undefined): AcaoDoBotao | null {
  const m = /^(ap|rc):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(data ?? "");
  return m ? { acao: m[1] === "ap" ? "aprovar" : "recusar", propostaId: m[2] } : null;
}

export const botoesDaProposta = (id: string) => [[{ text: "✅ Aprovar", callback_data: `ap:${id}` }, { text: "❌ Recusar", callback_data: `rc:${id}` }]];
