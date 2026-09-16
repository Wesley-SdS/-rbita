import type { SttOptions, SttResult } from "./types";
import { voiceServiceUrl } from "../voice/service-url";

/**
 * Transcrição local via serviço de voz (faster-whisper, `small` + tuning pt-BR).
 *
 * Não separa vozes: o faster-whisper transcreve, não diariza (isso exigiria um
 * modelo de embedding de locutor, ex.: pyannote, que o serviço não carrega).
 * Quando a diarização é pedida e cai aqui, marcamos `diarizationUnavailable`
 * para a UI avisar em vez de entregar um texto corrido fingindo separação.
 */
export async function transcribeWithLocalWhisper(file: File, opts: SttOptions = {}): Promise<SttResult> {
  const base = voiceServiceUrl();
  if (!base) throw new Error("voice service indisponível (VOICE_URL ausente ou inválida)");
  const url = base + "/stt";
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.webm");
  const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`voice service ${res.status}`);
  const d = (await res.json()) as { text?: string; language?: string };
  return {
    text: (d.text ?? "").trim(),
    language: d.language ?? "pt",
    provider: "whisper-local",
    ...(opts.diarize ? { diarizationUnavailable: true } : {}),
  };
}
