import type { SttResult } from "./types";
import { voiceServiceUrl } from "@/lib/voice/service-url";

/** Transcrição local via serviço de voz (faster-whisper, `small` + tuning pt-BR). */
export async function transcribeWithLocalWhisper(file: File): Promise<SttResult> {
  const base = voiceServiceUrl();
  if (!base) throw new Error("voice service indisponível (VOICE_URL ausente ou inválida)");
  const url = base + "/stt";
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.webm");
  const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`voice service ${res.status}`);
  const d = (await res.json()) as { text?: string; language?: string };
  return { text: (d.text ?? "").trim(), language: d.language ?? "pt", provider: "whisper-local" };
}
