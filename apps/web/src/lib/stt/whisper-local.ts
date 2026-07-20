import type { SttResult } from "./types";

/** Transcrição local via serviço de voz (faster-whisper, `small` + tuning pt-BR). */
export async function transcribeWithLocalWhisper(file: File): Promise<SttResult> {
  const url = (process.env.VOICE_URL ?? "http://localhost:8001") + "/stt";
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.webm");
  const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`voice service ${res.status}`);
  const d = (await res.json()) as { text?: string; language?: string };
  return { text: (d.text ?? "").trim(), language: d.language ?? "pt", provider: "whisper-local" };
}
