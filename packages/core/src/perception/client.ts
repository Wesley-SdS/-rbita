import { settings } from "../settings";
import { BIOMETRIC_HEADER, isLocalUrl } from "../privacy/egress";

/**
 * Cliente do serviço LOCAL de percepção (apps/perception). Todo tráfego daqui
 * carrega biometria (áudio de voz, foto de rosto, vetores), então:
 *   - toda requisição sai marcada com `x-orbita-biometria` (o guard do processo
 *     recusa se o destino não for local, mesmo que alguém mude a URL)
 *   - a URL configurada é conferida aqui também: falha antes de montar o corpo
 */

export class PerceptionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PerceptionError";
  }
}

async function base(): Promise<{ url: string; timeoutMs: number }> {
  const cfg = await settings.getMany(["identity.perceptionUrl", "identity.perceptionTimeoutMs"]);
  const url = cfg["identity.perceptionUrl"].replace(/\/+$/, "");
  if (!isLocalUrl(url)) throw new PerceptionError("O serviço de percepção precisa estar nesta casa (URL local).", 400);
  return { url, timeoutMs: cfg["identity.perceptionTimeoutMs"] };
}

async function post<T>(path: string, form: FormData, timeoutOverrideMs?: number): Promise<T> {
  const { url, timeoutMs: padrao } = await base();
  const timeoutMs = timeoutOverrideMs ?? padrao;
  // segredo compartilhado opcional: impede que uma página qualquer aberta no
  // navegador da casa use a percepção local (o serviço confere o mesmo valor)
  const token = process.env.PERCEPTION_TOKEN;
  let r: Response;
  try {
    r = await fetch(url + path, { method: "POST", body: form, headers: { [BIOMETRIC_HEADER]: "1", ...(token ? { "x-orbita-percepcao": token } : {}) }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new PerceptionError(`Serviço de percepção fora do ar (${e instanceof Error ? e.message : String(e)})`, 503);
  }
  if (!r.ok) {
    const corpo = (await r.json().catch(() => ({}))) as { detail?: string };
    throw new PerceptionError(corpo.detail ?? `percepção ${r.status}`, r.status === 422 || r.status === 413 ? r.status : 502);
  }
  return (await r.json()) as T;
}

const arquivo = (bytes: Uint8Array, mime: string) => new Blob([bytes as BlobPart], { type: mime || "application/octet-stream" });

export interface VoiceEmbedResult {
  model: string;
  dim: number;
  embedding: number[];
  durationS: number;
  speechS: number;
}

export async function embedVoice(audio: Uint8Array, mime: string, model: string, timeoutMs?: number): Promise<VoiceEmbedResult> {
  const f = new FormData();
  f.append("file", arquivo(audio, mime), "audio");
  f.append("model", model);
  return post<VoiceEmbedResult>("/voice/embed", f, timeoutMs);
}

export interface SegmentEmbedding {
  start: number;
  end: number;
  speechS: number;
  embedding?: number[];
  erro?: string;
}

export async function embedVoiceSegments(audio: Uint8Array, mime: string, model: string, segments: { start: number; end: number }[]): Promise<{ model: string; dim: number; segments: SegmentEmbedding[] }> {
  const f = new FormData();
  f.append("file", arquivo(audio, mime), "audio");
  f.append("segments", JSON.stringify(segments));
  f.append("model", model);
  return post("/voice/embed-segments", f);
}

export interface FaceResult {
  bbox: [number, number, number, number];
  score: number;
  size: number;
  embedding: number[];
}

export async function embedFaces(image: Uint8Array, mime: string, backend: string): Promise<{ backend: string; width: number; height: number; faces: FaceResult[] }> {
  const f = new FormData();
  f.append("file", arquivo(image, mime), "image");
  f.append("backend", backend);
  return post("/face/embed", f);
}

export interface GestureResult {
  gesto: string;
  confianca: number;
  mao: string;
}

/** Gestos num keyframe (CAM.4). Pipeline separado da narração, como manda o briefing §7.1. */
export async function detectGestures(image: Uint8Array, mime: string): Promise<{ ms: number; vocabulario: string[]; gestos: GestureResult[] }> {
  const f = new FormData();
  f.append("file", arquivo(image, mime), "image");
  return post("/pose/gesture", f);
}

export async function perceptionHealth(): Promise<{ status: string; disponiveis: { voz: string[]; rosto: string[] } } | null> {
  try {
    const { url } = await base();
    const r = await fetch(url + "/health", { signal: AbortSignal.timeout(3000) });
    return r.ok ? ((await r.json()) as { status: string; disponiveis: { voz: string[]; rosto: string[] } }) : null;
  } catch {
    return null;
  }
}
