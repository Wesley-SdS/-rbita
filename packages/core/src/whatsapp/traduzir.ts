import { gowaMediaOf, type GowaMediaKind, type GowaMessagePayload } from "./gowa/eventos";

/**
 * Tradução PURA do payload do GOWA para a língua da Órbita, portada do
 * `gowa-message.translator.ts` do `whatsapp-workspace`. É aqui, e só aqui, que
 * o formato do fornecedor é conhecido: trocar de ponte muda este arquivo.
 *
 * Diferença deliberada em relação ao workspace: lá o JID ia cru e o LID era
 * ignorado. Aqui o JID é NORMALIZADO, porque a conversa "Eu" é reconhecida
 * comparando o chat com o número do dono, e "5511...:12@s.whatsapp.net" (com
 * o número do aparelho) tem de casar com "5511...@s.whatsapp.net".
 */
export type TipoMensagem = "texto" | "imagem" | "audio" | "video" | "documento" | "figurinha" | "localizacao" | "contato";

export interface MidiaTraduzida {
  kind: GowaMediaKind;
  /** caminho local no GOWA (`statics/media/...`) */
  path: string | null;
  url: string | null;
  filename: string | null;
  mimeType: string | null;
}

export interface MensagemTraduzida {
  externalId: string;
  chatJid: string;
  autorJid: string | null;
  autorNome: string | null;
  tipo: TipoMensagem;
  texto: string | null;
  em: Date;
  respondeA: string | null;
  deMim: boolean;
  grupo: boolean;
  /** atualização de status (`status@broadcast`), não é conversa */
  status: boolean;
  midia: MidiaTraduzida | null;
}

const TIPO_POR_MIDIA: Record<GowaMediaKind, TipoMensagem> = {
  image: "imagem",
  video: "video",
  video_note: "video",
  audio: "audio",
  document: "documento",
  sticker: "figurinha",
};

/** O GOWA manda RFC3339 na maioria dos eventos e epoch (s ou ms) em alguns. */
export function dataDoGowa(valor: unknown, reserva: Date = new Date()): Date {
  if (typeof valor === "number" && Number.isFinite(valor)) return new Date(valor > 1e12 ? valor : valor * 1000);
  if (typeof valor === "string" && valor) {
    if (/^\d+$/.test(valor)) return dataDoGowa(Number(valor), reserva);
    const d = new Date(valor);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return reserva;
}

/**
 * JID canônico: sem o sufixo de aparelho (`:12`) e em minúsculas.
 * "5511999998888:12@s.whatsapp.net" → "5511999998888@s.whatsapp.net".
 * Número solto vira JID de pessoa. Grupo e LID ficam como estão.
 */
export function normalizarJid(jid: string): string {
  const j = jid.trim().toLowerCase();
  if (!j) return j;
  if (!j.includes("@")) {
    const digitos = j.replace(/\D/g, "");
    return digitos ? `${digitos}@s.whatsapp.net` : j;
  }
  const [usuario, servidor] = j.split("@");
  return `${usuario.split(":")[0]}@${servidor}`;
}

/** O número de um JID de pessoa ("5511...@s.whatsapp.net" → "5511..."); nulo para grupo/LID. */
export function numeroDoJid(jid: string): string | null {
  const j = normalizarJid(jid);
  return j.endsWith("@s.whatsapp.net") ? j.split("@")[0] : null;
}

export const ehGrupo = (jid: string) => normalizarJid(jid).endsWith("@g.us");

export function traduzirMensagem(p: GowaMessagePayload): MensagemTraduzida {
  const m = gowaMediaOf(p);
  const tipo: TipoMensagem = m
    ? TIPO_POR_MIDIA[m.kind]
    : p.location !== undefined || p.live_location !== undefined
      ? "localizacao"
      : p.contact !== undefined || p.contacts !== undefined
        ? "contato"
        : "texto";

  let midia: MidiaTraduzida | null = null;
  if (m) {
    midia =
      typeof m.ref === "string"
        ? { kind: m.kind, path: m.ref, url: null, filename: null, mimeType: null }
        : { kind: m.kind, path: m.ref.path ?? null, url: m.ref.url ?? null, filename: m.ref.filename ?? null, mimeType: m.ref.mime_type ?? null };
  }
  const legenda = m && typeof m.ref !== "string" ? m.ref.caption : undefined;
  const chatJid = normalizarJid(p.chat_id);
  const grupo = chatJid.endsWith("@g.us");
  const autor = p.from ? normalizarJid(p.from) : grupo ? null : chatJid;

  return {
    externalId: p.id,
    chatJid,
    autorJid: autor,
    autorNome: p.from_name?.trim() || p.sender_display_name?.trim() || null,
    tipo,
    texto: (p.body ?? legenda ?? "").trim() || null,
    em: dataDoGowa(p.timestamp),
    respondeA: p.replied_to_id ?? null,
    deMim: p.is_from_me === true,
    grupo,
    status: chatJid === "status@broadcast",
    midia,
  };
}
