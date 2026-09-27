import { geminiTtsAvailable, synthesizeGemini } from "./tts-gemini";
import { EDGE_MIME, edgeTtsAvailable, synthesizeEdge } from "./tts-edge";
import { voiceServiceUrl } from "./service-url";
import { FLUXO, registrarUso } from "../usage/registrar";
import { log } from "../observability/logger";

/**
 * A fala da Órbita, fora da rota (PRD-WHATSAPP W4): a rota `/api/tts` e a nota
 * de voz do WhatsApp usam a MESMA cadeia, com a mesma conta.
 *
 * Cadeia: Edge (voz Vivienne, grátis e rápida) → Gemini (Sulafat, se houver
 * chave e cota) → Piper (local, robótico mas sempre disponível). Cada degrau só
 * é usado se o anterior falhar, então uma indisponibilidade não emudece a Órbita.
 * `TTS_PROVIDER` fixa um provedor: `edge` | `gemini` | `piper` (padrão `auto`).
 */

export class FalaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "FalaError";
  }
}

export interface Fala {
  bytes: Uint8Array;
  mime: string;
  servico: "edge-tts" | "gemini-tts" | "piper";
}

/**
 * Registra a fala na conta da casa. O Edge e o Piper saem de graça, e é
 * justamente por isso que precisam de linha: sem elas, "a Órbita falou 900
 * vezes este mês sem custo" fica indistinguível de "ninguém mediu a fala".
 */
function registrarFala(userId: string | undefined, servico: string, texto: string, comecou: number, erro?: string): void {
  if (!userId) return;
  registrarUso({ userId, fluxo: FLUXO.tts, servico, consumo: { unidade: "caracteres", entrada: 0, saida: texto.length }, duracaoMs: Date.now() - comecou, erro: erro ?? null });
}

export async function sintetizarFala(texto: string, opts: { userId?: string; signal?: AbortSignal; lengthScale?: number } = {}): Promise<Fala> {
  const provider = process.env.TTS_PROVIDER ?? "auto";
  const fixo = provider !== "auto";
  const comecou = Date.now();
  const abortado = () => opts.signal?.aborted === true;

  if ((provider === "auto" || provider === "edge") && edgeTtsAvailable()) {
    try {
      const buf = await synthesizeEdge(texto, opts.signal);
      registrarFala(opts.userId, "edge-tts", texto, comecou);
      return { bytes: new Uint8Array(buf), mime: EDGE_MIME, servico: "edge-tts" };
    } catch (e) {
      if (abortado()) throw new FalaError("interrompida", 499); // barge-in
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("tts.edge_falhou", { erro: msg.slice(0, 200) });
      // a falha também vira linha: é ela que explica por que o mês seguinte
      // veio mais caro (a cadeia caiu para um degrau pago)
      registrarFala(opts.userId, "edge-tts", texto, comecou, msg.slice(0, 200));
      if (fixo) throw new FalaError("TTS falhou", 502);
    }
  }

  if ((provider === "auto" || provider === "gemini") && geminiTtsAvailable()) {
    try {
      const buf = await synthesizeGemini(texto, opts.signal);
      registrarFala(opts.userId, "gemini-tts", texto, comecou);
      return { bytes: new Uint8Array(buf), mime: "audio/wav", servico: "gemini-tts" };
    } catch (e) {
      if (abortado()) throw new FalaError("interrompida", 499);
      // cota estourada (10/dia no free) ou API fora: cai para o Piper
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("tts.gemini_falhou", { erro: msg.slice(0, 200) });
      registrarFala(opts.userId, "gemini-tts", texto, comecou, msg.slice(0, 200));
      if (fixo) throw new FalaError("TTS falhou", 502);
    }
  }

  // Piper, no serviço de voz Python (último recurso / modo totalmente offline)
  const base = voiceServiceUrl();
  if (!base) {
    registrarFala(opts.userId, "piper", texto, comecou, "piper_indisponivel");
    throw new FalaError("Serviço de voz indisponível", 503);
  }
  let res: Response;
  try {
    res = await fetch(base + "/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: texto, ...(opts.lengthScale !== undefined ? { length_scale: opts.lengthScale } : {}) }),
      signal: opts.signal,
    });
  } catch {
    // barge-in no Piper é interrupção, não serviço fora (nem linha de falha na conta)
    if (abortado()) throw new FalaError("interrompida", 499);
    registrarFala(opts.userId, "piper", texto, comecou, "piper_indisponivel");
    throw new FalaError("Serviço de voz indisponível", 503);
  }
  if (!res.ok) {
    registrarFala(opts.userId, "piper", texto, comecou, "piper_indisponivel");
    throw new FalaError("TTS falhou", res.status);
  }
  registrarFala(opts.userId, "piper", texto, comecou);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: "audio/wav", servico: "piper" };
}

/**
 * Converte a fala para OGG/Opus, o formato da NOTA DE VOZ do WhatsApp (em MP3
 * ela chega como anexo, sem forma de onda). Quem converte é o serviço de voz
 * (PyAV com libopus embutido), para a máquina não precisar de ffmpeg.
 */
export async function paraNotaDeVoz(fala: Pick<Fala, "bytes" | "mime">): Promise<{ bytes: Uint8Array; mime: string }> {
  if (fala.mime.startsWith("audio/ogg")) return fala;
  const base = voiceServiceUrl();
  if (!base) throw new FalaError("Serviço de voz indisponível para gerar a nota de voz", 503);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fala.bytes)], { type: fala.mime }), fala.mime.includes("mpeg") ? "fala.mp3" : "fala.wav");
  const res = await fetch(base + "/converter/ogg", { method: "POST", body: form, signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res?.ok) throw new FalaError("Não consegui gerar a nota de voz", res?.status ?? 503);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: "audio/ogg; codecs=opus" };
}
