import { settings } from "../../settings";
import { isLocalUrl } from "../../privacy/egress";
import { log } from "../../observability/logger";

/**
 * Cliente do GOWA (go-whatsapp-web-multidevice), a ponte LOCAL para o WhatsApp
 * pessoal. Portado do `gowa.client.ts` + `gowa-provider.adapter.ts` do
 * `whatsapp-workspace`, sem a camada de organização.
 *
 * A ponte carrega a conta INTEIRA do dono (ler, mandar, como ele). Por isso a
 * URL é conferida a cada chamada: endereço fora de casa é recusado antes de
 * montar qualquer requisição, mesmo que alguém mude a config.
 *
 * Armadilhas já pagas no workspace e mantidas aqui:
 *   - toda rota exige `X-Device-Id`, inclusive a de mídia (`/statics`);
 *   - multipart NÃO leva Content-Type à mão (o fetch põe o boundary);
 *   - "não pareado" chega de três jeitos, e nenhum melhora tentando de novo;
 *   - as respostas misturam `snake_case` e o `PascalCase` do whatsmeow.
 */

export class PonteError extends Error {
  constructor(
    message: string,
    /** `sem_sessao` não adianta retentar; `fora_do_ar` e `instavel` sim */
    public readonly motivo: "sem_sessao" | "fora_do_ar" | "tempo" | "instavel" | "recusado" | "nao_local" | "nao_configurada",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PonteError";
  }
}

/** Eventos pedidos ao GOWA. Ack e presença ficam de fora: a Órbita não mostra tique nem "digitando". */
export const EVENTOS_DO_WEBHOOK = ["message", "message.revoked", "message.edited", "message.reaction"].join(",");

interface Requisicao {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  deviceId?: string;
  body?: unknown;
  form?: FormData;
}

async function base(): Promise<{ url: string; timeoutMs: number }> {
  const cfg = await settings.getMany(["whatsapp.ponteUrl", "whatsapp.ponteTimeoutMs"]);
  const url = cfg["whatsapp.ponteUrl"].replace(/\/+$/, "");
  if (!isLocalUrl(url)) throw new PonteError("A ponte do WhatsApp precisa estar nesta casa (endereço local).", "nao_local");
  return { url, timeoutMs: cfg["whatsapp.ponteTimeoutMs"] };
}

/** A ponte tem senha? Sem ela, nada é chamado (e a saúde diz "mal configurado"). */
export function ponteConfigurada(): boolean {
  return Boolean(process.env.GOWA_BASIC_AUTH?.includes(":"));
}

function autorizacao(): string {
  // Sem padrão de propósito: com `admin:admin` a conta inteira do dono ficaria
  // atrás de uma senha que todo mundo conhece. O compose também recusa subir sem.
  if (!ponteConfigurada()) throw new PonteError("Falta GOWA_BASIC_AUTH (usuário:senha da ponte) no .env da raiz.", "nao_configurada");
  return "Basic " + Buffer.from(process.env.GOWA_BASIC_AUTH!).toString("base64");
}

/** "Não pareado" tem TRÊS formas no GOWA; as três significam a mesma coisa. */
export function semSessao(detalhe: string): boolean {
  return /INVALID_WA_CLI|AUTHENTICATION_ERROR|not logged in|session deleted/i.test(detalhe);
}

async function executar(r: Requisicao): Promise<Response> {
  const { url, timeoutMs } = await base();
  const auth = autorizacao();
  const inicio = Date.now();
  let res: Response;
  try {
    res = await fetch(url + r.path, {
      method: r.method,
      headers: {
        Authorization: auth,
        ...(r.form ? {} : { "Content-Type": "application/json" }),
        ...(r.deviceId ? { "X-Device-Id": r.deviceId } : {}),
      },
      ...(r.form ? { body: r.form } : r.body !== undefined ? { body: JSON.stringify(r.body) } : {}),
      // upload de mídia em rede ruim passa do tempo comum com facilidade
      signal: AbortSignal.timeout(r.form ? timeoutMs * 4 : timeoutMs),
    });
  } catch (e) {
    const abortou = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    log.warn("whatsapp.ponte_rede", { path: semConsulta(r.path), ms: Date.now() - inicio, timeout: abortou });
    // `tempo` é diferente de fora do ar: num ENVIO, a ponte pode ter aceitado e
    // mandado a mensagem antes de o prazo acabar (ver EnvioIncerto)
    throw new PonteError(abortou ? "A ponte do WhatsApp demorou para responder." : "A ponte do WhatsApp está fora do ar.", abortou ? "tempo" : "fora_do_ar");
  }
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    // o corpo do erro fica no log, nunca na resposta ao usuário
    log.warn("whatsapp.ponte_erro", { path: semConsulta(r.path), status: res.status, detalhe: detalhe.slice(0, 300) });
    if (semSessao(detalhe)) throw new PonteError("O WhatsApp não está pareado. Conecte o número em Conectores.", "sem_sessao", res.status);
    throw new PonteError(res.status >= 500 ? "A ponte do WhatsApp está instável. Tente de novo em instantes." : "O WhatsApp recusou a operação.", res.status >= 500 ? "instavel" : "recusado", res.status);
  }
  return res;
}

/** O caminho sem a query: `login/code?phone=` levaria o número do dono para o log. */
const semConsulta = (path: string) => path.split("?")[0];

async function json<T>(r: Requisicao): Promise<T> {
  return (await (await executar(r)).json()) as T;
}

/** Lê um campo nas duas grafias que o GOWA usa (`message_id` / `MessageID`). */
function campo<T>(o: unknown, ...nomes: string[]): T | undefined {
  if (!o || typeof o !== "object") return undefined;
  for (const n of nomes) {
    const v = (o as Record<string, unknown>)[n];
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

function idDaMensagem(resposta: unknown): string {
  const results = campo<unknown>(resposta, "results", "Results");
  const id = campo<string>(results, "message_id", "MessageID", "id") ?? campo<string>(resposta, "message_id", "MessageID");
  // sem id não há como reconhecer o eco depois: falhar aqui é melhor que
  // aceitar uma mensagem que a Órbita tomaria por nova do dono
  if (!id) throw new PonteError("A ponte não devolveu o id da mensagem enviada.", "instavel");
  return id;
}

const enc = encodeURIComponent;

// ── sessão ──

export async function criarDispositivo(deviceId: string, webhookUrl: string, webhookSegredo: string): Promise<void> {
  try {
    await json({ method: "POST", path: "/devices", body: { device_id: deviceId, webhook_url: webhookUrl, webhook_secret: webhookSegredo, webhook_events: EVENTOS_DO_WEBHOOK } });
  } catch (e) {
    // O slot já existir (segundo pareamento, reinício da Órbita com o GOWA de
    // pé) não é erro. O GOWA v9.5 responde isso com 500 genérico e o motivo só
    // na mensagem ("device X already exists", medido em 27/09/2026), então a
    // prova é perguntar pelo dispositivo: se ele responde, está lá.
    if (!(e instanceof PonteError) || e.motivo === "fora_do_ar" || e.motivo === "nao_local") throw e;
    await json({ method: "GET", path: `/devices/${enc(deviceId)}` });
  }
}

/** O webhook é reafirmado a cada pareamento: barato, e cobre URL que mudou na config. */
export async function apontarWebhook(deviceId: string, webhookUrl: string, webhookSegredo: string): Promise<void> {
  await json({ method: "PATCH", path: `/devices/${enc(deviceId)}/webhook`, body: { webhook_url: webhookUrl, webhook_secret: webhookSegredo, webhook_events: EVENTOS_DO_WEBHOOK } });
}

export interface Pareamento {
  /** data URL do PNG (o link do GOWA é interno e tem auth: o navegador não alcança) */
  qr: string | null;
  codigo: string | null;
  expiraEm: Date;
}

export async function parearPorQr(deviceId: string): Promise<Pareamento> {
  const r = await json<unknown>({ method: "GET", path: `/devices/${enc(deviceId)}/login` });
  const results = campo<unknown>(r, "results", "Results");
  const link = campo<string>(results, "qr_link", "QRLink");
  const duracao = Number(campo<number>(results, "qr_duration", "QRDuration") ?? 30);
  return { qr: link ? await baixarQr(link) : null, codigo: null, expiraEm: new Date(Date.now() + duracao * 1000) };
}

export async function parearPorCodigo(deviceId: string, telefone: string): Promise<Pareamento> {
  const r = await json<unknown>({ method: "POST", path: `/devices/${enc(deviceId)}/login/code?phone=${enc(telefone.replace(/\D/g, ""))}` });
  const codigo = campo<string>(campo(r, "results", "Results"), "pair_code", "PairCode") ?? null;
  // o WhatsApp aceita o código por pouco tempo
  return { qr: null, codigo, expiraEm: new Date(Date.now() + 60_000) };
}

async function baixarQr(link: string): Promise<string> {
  const caminho = link.startsWith("http") ? new URL(link).pathname : `/${link.replace(/^\/+/, "")}`;
  const res = await executar({ method: "GET", path: caminho });
  const tipo = res.headers.get("content-type") ?? "image/png";
  return `data:${tipo};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

export interface EstadoDaPonte {
  conectado: boolean;
  logado: boolean;
  jid: string | null;
}

export async function estado(deviceId: string): Promise<EstadoDaPonte> {
  const s = await json<unknown>({ method: "GET", path: `/devices/${enc(deviceId)}/status` });
  const results = campo<unknown>(s, "results", "Results");
  const logado = campo<boolean>(results, "is_logged_in", "IsLoggedIn") === true;
  let jid: string | null = null;
  if (logado) {
    const info = await json<unknown>({ method: "GET", path: `/devices/${enc(deviceId)}` });
    jid = campo<string>(campo(info, "results", "Results"), "jid", "JID") || null;
  }
  return { conectado: campo<boolean>(results, "is_connected", "IsConnected") === true, logado, jid };
}

export async function desconectar(deviceId: string): Promise<void> {
  await json({ method: "POST", path: `/devices/${enc(deviceId)}/logout` });
}

/** Tira o slot da ponte (apagar a conta): sem ele, a ponte não guarda mais nada do número. */
export async function removerDispositivo(deviceId: string): Promise<void> {
  await json({ method: "DELETE", path: `/devices/${enc(deviceId)}` });
}

export async function reconectar(deviceId: string): Promise<void> {
  await json({ method: "POST", path: `/devices/${enc(deviceId)}/reconnect` });
}

// ── envio ──

export async function enviarTexto(deviceId: string, paraJid: string, texto: string, citando?: string | null): Promise<string> {
  const r = await json<unknown>({ method: "POST", path: "/send/message", deviceId, body: { phone: paraJid, message: texto, ...(citando ? { reply_message_id: citando } : {}) } });
  return idDaMensagem(r);
}

export type TipoDeMidia = "image" | "audio" | "document";
const ROTA: Record<TipoDeMidia, { path: string; campo: string }> = {
  image: { path: "/send/image", campo: "image" },
  // `/send/audio` vira nota de voz (com forma de onda) no celular
  audio: { path: "/send/audio", campo: "audio" },
  document: { path: "/send/file", campo: "file" },
};

export async function enviarMidia(deviceId: string, paraJid: string, tipo: TipoDeMidia, bytes: Uint8Array, mime: string, nomeArquivo: string, legenda?: string | null): Promise<string> {
  const { path, campo: nomeDoCampo } = ROTA[tipo];
  const form = new FormData();
  form.append("phone", paraJid);
  form.append(nomeDoCampo, new Blob([new Uint8Array(bytes)], { type: mime }), nomeArquivo);
  if (legenda && tipo === "image") form.append("caption", legenda);
  // Sem `ptt`, o GOWA manda o OGG como anexo de áudio genérico, e o WhatsApp
  // não o mostrava como nota de voz (o dono não recebeu a primeira resposta em
  // áudio, 27/09/2026). Com `ptt`, a ponte ainda passa pelo ffmpeg dela.
  if (tipo === "audio") form.append("ptt", "true");
  const r = await (await executar({ method: "POST", path, deviceId, form })).json();
  return idDaMensagem(r);
}

// ── mídia recebida ──

/**
 * Baixa a mídia de uma mensagem. Dois caminhos, nessa ordem: o arquivo que o
 * GOWA já gravou (barato) e, se ele não for servido, o download pela API, que
 * faz o GOWA buscar e decifrar (a chave da mídia vive na sessão dele). O
 * workspace mediu o primeiro falhando entre versões; o segundo é o documentado.
 */
export async function baixarMidia(deviceId: string, ref: { path: string | null; externalId: string; mime: string | null; chat: string }, maxBytes: number): Promise<{ bytes: Uint8Array; mime: string }> {
  if (ref.path) {
    try {
      const caminho = ref.path.startsWith("http") ? new URL(ref.path).pathname : `/${ref.path.replace(/^\/+/, "")}`;
      const res = await executar({ method: "GET", path: caminho, deviceId });
      const bytes = await lerComTeto(res, maxBytes);
      if (bytes.length) return { bytes, mime: ref.mime || res.headers.get("content-type") || "application/octet-stream" };
    } catch (e) {
      if (e instanceof MidiaGrandeDemais) throw e;
      log.info("whatsapp.midia_caminho_local_falhou", { erro: e instanceof Error ? e.message : String(e) });
    }
  }
  // A rota de download exige o CHAT (`phone`): sem ele o GOWA responde 400
  // "phone: cannot be blank". A mensagem do webhook quase nunca chega aqui (vem
  // com o arquivo local), mas a RECUPERADA do histórico só tem a URL cifrada do
  // WhatsApp, e todo áudio recuperado se perdia (28/09/2026).
  const res = await executar({ method: "GET", path: `/message/${enc(ref.externalId)}/download?phone=${encodeURIComponent(ref.chat)}`, deviceId });
  // A rota NÃO devolve o arquivo: devolve um JSON dizendo onde o gravou
  // (`results.file_path`). Esse JSON ia como se fosse o áudio, a AssemblyAI
  // recusava ("File type application/json") e a transcrição se perdia
  // (08/10/2026). Segue o caminho e baixa o arquivo de verdade.
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    const corpo = (await res.json().catch(() => null)) as { results?: { file_path?: string } } | null;
    const arquivo = corpo?.results?.file_path?.trim();
    if (!arquivo) throw new PonteError("A ponte do WhatsApp não disse onde gravou a mídia.", "instavel");
    const real = await executar({ method: "GET", path: `/${arquivo.replace(/^\/+/, "")}`, deviceId });
    const bytes = await lerComTeto(real, maxBytes);
    const tipo = real.headers.get("content-type") ?? "";
    return { bytes, mime: ref.mime || (tipo && !tipo.includes("json") ? tipo : "application/octet-stream") };
  }
  return { bytes: await lerComTeto(res, maxBytes), mime: ref.mime || res.headers.get("content-type") || "application/octet-stream" };
}

export class MidiaGrandeDemais extends Error {
  constructor(public readonly bytes: number | null) {
    super("Mídia maior que o tamanho máximo configurado");
    this.name = "MidiaGrandeDemais";
  }
}

/**
 * Lê o corpo parando no teto. Conferir só DEPOIS de `arrayBuffer()` deixava um
 * vídeo de 900 MB entrar inteiro na memória do processo antes de ser recusado.
 */
export async function lerComTeto(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declarado = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declarado) && declarado > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new MidiaGrandeDemais(declarado);
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const partes: Uint8Array[] = [];
  let total = 0;
  const leitor = res.body.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await leitor.cancel().catch(() => undefined);
      throw new MidiaGrandeDemais(null);
    }
    partes.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export async function marcarLida(deviceId: string, chatJid: string, externalId: string): Promise<void> {
  await json({ method: "POST", path: `/message/${enc(externalId)}/read`, deviceId, body: { phone: chatJid } });
}

// ── histórico (recuperar o que o webhook não entregou) ──

export interface ChatDaPonte {
  jid: string;
  ultimaMensagemEm: Date | null;
}

/** Chats com movimento mais recente primeiro (o GOWA guarda o histórico da sessão). */
export async function listarChats(deviceId: string, limite: number): Promise<ChatDaPonte[]> {
  const r = await json<unknown>({ method: "GET", path: `/chats?limit=${limite}`, deviceId });
  const lista = campo<unknown[]>(campo(r, "results", "Results"), "data", "Data") ?? [];
  return lista.map((c) => {
    const quando = campo<string>(c, "last_message_time", "LastMessageTime");
    return { jid: String(campo(c, "jid", "JID") ?? ""), ultimaMensagemEm: quando ? new Date(quando) : null };
  }).filter((c) => c.jid);
}

/** Uma mensagem do histórico da ponte, com os nomes do GOWA. */
export interface MensagemDaPonte {
  id: string;
  chat_jid: string;
  sender_jid?: string;
  sender_display_name?: string;
  content?: string;
  timestamp?: string;
  is_from_me?: boolean;
  media_type?: string;
  filename?: string;
  url?: string;
}

export async function mensagensDoChatNaPonte(deviceId: string, jid: string, limite: number): Promise<MensagemDaPonte[]> {
  const r = await json<unknown>({ method: "GET", path: `/chat/${enc(jid)}/messages?limit=${limite}`, deviceId });
  return (campo<MensagemDaPonte[]>(campo(r, "results", "Results"), "data", "Data") ?? []).filter((m) => m && typeof m.id === "string");
}
