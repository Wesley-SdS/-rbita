import { log } from "../observability/logger";
import type { SttOptions, SttResult } from "./types";
import { transcribeWithAssemblyAI } from "./assemblyai";
import { transcribeWithLocalWhisper } from "./whisper-local";

export type { SttResult, SttOptions, SttUtterance } from "./types";

/**
 * Resolve o melhor STT disponível:
 *   1. AssemblyAI (Universal-3.5 Pro) quando há `ASSEMBLYAI_API_KEY` — melhor
 *      pt-BR e o ÚNICO caminho com separação de vozes;
 *   2. faster-whisper local (serviço de voz) como fallback / modo sem nuvem.
 * Se o AssemblyAI falhar, cai automaticamente para o local — inclusive quando a
 * diarização foi pedida: transcrição sem separação é melhor que nada, e o
 * resultado vem marcado com `diarizationUnavailable`.
 */
export async function transcribeAudio(file: File, opts: SttOptions = {}): Promise<SttResult> {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (key) {
    try {
      return await transcribeWithAssemblyAI(file, key, opts);
    } catch (e) {
      log.error("stt.assemblyai", { error: e instanceof Error ? e.message : String(e), diarize: Boolean(opts.diarize) });
    }
  }
  return transcribeWithLocalWhisper(file, opts);
}
