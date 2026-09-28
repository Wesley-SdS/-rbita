/**
 * Cliente da Bot API do Telegram. Endereço fixo no código (nunca vindo de
 * modelo nem de mensagem): o único dado externo que entra numa URL é o
 * `file_path` que o PRÓPRIO Telegram devolveu, sob o domínio dele.
 *
 * O token nunca vai para log nem para erro: ele está dentro da URL, então toda
 * mensagem de erro é montada aqui, sem a URL.
 */

const BASE = "https://api.telegram.org";

export class TelegramErro extends Error {
  constructor(
    message: string,
    readonly codigo: number | null,
    /** segundos para esperar, quando o Telegram pede (429) */
    readonly esperar: number | null = null,
  ) {
    super(message);
  }
}

interface Resposta<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

async function chamar<T>(token: string, metodo: string, corpo?: Record<string, unknown> | FormData, timeoutMs = 15_000): Promise<T> {
  const init: RequestInit = { method: "POST", signal: AbortSignal.timeout(timeoutMs) };
  if (corpo instanceof FormData) init.body = corpo;
  else if (corpo) {
    init.body = JSON.stringify(corpo);
    init.headers = { "Content-Type": "application/json" };
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/bot${token}/${metodo}`, init);
  } catch (e) {
    throw new TelegramErro(`Telegram fora do ar (${metodo}): ${e instanceof Error ? e.name : "rede"}`, null);
  }
  const j = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as Resposta<T>;
  if (!j.ok || j.result === undefined) throw new TelegramErro(`Telegram recusou ${metodo}: ${j.description ?? res.status}`, j.error_code ?? res.status, j.parameters?.retry_after ?? null);
  return j.result;
}

export interface TgUsuario {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TgArquivo {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
  duration?: number;
}

export interface TgMensagemApi {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: TgUsuario;
  text?: string;
  caption?: string;
  voice?: TgArquivo;
  audio?: TgArquivo;
  photo?: (TgArquivo & { width: number; height: number })[];
  document?: TgArquivo;
  video?: TgArquivo;
  video_note?: TgArquivo;
  sticker?: TgArquivo;
  location?: { latitude: number; longitude: number };
  contact?: { phone_number: string; first_name?: string };
}

export interface TgCallback {
  id: string;
  from: TgUsuario;
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMensagemApi;
  callback_query?: TgCallback;
}

export interface Botao {
  text: string;
  callback_data: string;
}

export const eu = (token: string) => chamar<TgUsuario>(token, "getMe");

/** Espera longa: o Telegram segura a resposta até chegar algo ou `espera` segundos passarem. */
export const atualizacoes = (token: string, desde: number, espera: number) =>
  chamar<TgUpdate[]>(token, "getUpdates", { offset: desde, timeout: espera, allowed_updates: ["message", "callback_query"] }, (espera + 10) * 1000);

export const mandarTexto = (token: string, chatId: string, texto: string, botoes?: Botao[][]) =>
  chamar<TgMensagemApi>(token, "sendMessage", {
    chat_id: chatId,
    text: texto.slice(0, 4096),
    ...(botoes?.length ? { reply_markup: { inline_keyboard: botoes } } : {}),
  });

export async function mandarVoz(token: string, chatId: string, audio: Uint8Array, mime: string): Promise<TgMensagemApi> {
  const form = new FormData();
  form.append("chat_id", chatId);
  // OGG/Opus vira nota de voz (a bolinha com a onda); outro formato vai como áudio comum
  const ehOgg = mime.startsWith("audio/ogg");
  form.append(ehOgg ? "voice" : "audio", new Blob([new Uint8Array(audio)], { type: mime.split(";")[0] }), ehOgg ? "orbita.ogg" : "orbita.mp3");
  return chamar<TgMensagemApi>(token, ehOgg ? "sendVoice" : "sendAudio", form, 60_000);
}

export const digitando = (token: string, chatId: string, acao: "typing" | "record_voice" = "typing") => chamar<boolean>(token, "sendChatAction", { chat_id: chatId, action: acao }).catch(() => false);

export const responderBotao = (token: string, callbackId: string, texto?: string) =>
  chamar<boolean>(token, "answerCallbackQuery", { callback_query_id: callbackId, ...(texto ? { text: texto.slice(0, 200) } : {}) }).catch(() => false);

/** Tira os botões da proposta depois de decidida: clicar de novo não pode aprovar de novo. */
export const tirarBotoes = (token: string, chatId: string, messageId: number) =>
  chamar<unknown>(token, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => null);

export const definirComandos = (token: string) =>
  chamar<boolean>(token, "setMyCommands", {
    commands: [
      { command: "start", description: "Começar (ou entrar com um convite)" },
      { command: "pendentes", description: "O que está esperando sua aprovação" },
    ],
  }).catch(() => false);

/** Baixa um arquivo que chegou. O Bot API só entrega até 20 MB. */
export async function baixarArquivo(token: string, fileId: string, maxBytes: number): Promise<Uint8Array> {
  const f = await chamar<{ file_path?: string; file_size?: number }>(token, "getFile", { file_id: fileId });
  if (!f.file_path) throw new TelegramErro("Arquivo sem caminho no Telegram.", null);
  if (f.file_size && f.file_size > maxBytes) throw new TelegramErro(`Arquivo grande demais (${Math.round(f.file_size / 1048576)} MB).`, 413);
  let res: Response;
  try {
    res = await fetch(`${BASE}/file/bot${token}/${f.file_path.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new TelegramErro("Não consegui baixar o arquivo do Telegram.", null);
  }
  if (!res.ok) throw new TelegramErro(`Download do arquivo falhou (${res.status}).`, res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > maxBytes) throw new TelegramErro("Arquivo grande demais.", 413);
  return bytes;
}
