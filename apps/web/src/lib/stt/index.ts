import { log } from "@/lib/observability/logger";
import type { SttResult } from "./types";
import { transcribeWithAssemblyAI } from "./assemblyai";
import { transcribeWithLocalWhisper } from "./whisper-local";

export type { SttResult };

/**
 * Resolve o melhor STT disponível:
 *   1. AssemblyAI (Universal-3 Pro) quando há `ASSEMBLYAI_API_KEY` — melhor pt-BR;
 *   2. faster-whisper local (serviço de voz) como fallback / modo sem nuvem.
 * Se o AssemblyAI falhar, cai automaticamente para o local.
 */
export async function transcribeAudio(file: File): Promise<SttResult> {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (key) {
    try {
      return await transcribeWithAssemblyAI(file, key);
    } catch (e) {
      log.error("stt.assemblyai", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return transcribeWithLocalWhisper(file);
}
