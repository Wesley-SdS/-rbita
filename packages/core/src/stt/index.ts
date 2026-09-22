import { log } from "../observability/logger";
import { settings } from "../settings";
import type { SttOptions, SttResult } from "./types";
import { transcribeWithAssemblyAI } from "./assemblyai";
import { registrarUso, FLUXO } from "../usage/registrar";
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
  const comecou = Date.now();
  // a nuvem é escolha do dono, e escolha precisa de tela (§5.6): a chave no
  // .env habilita, a chave em `setting` decide
  const permiteNuvem = (await settings.get("meetings.sttCloud").catch(() => "quando_houver_chave")) !== "nunca";
  const key = permiteNuvem ? process.env.ASSEMBLYAI_API_KEY : undefined;
  if (key) {
    try {
      const r = await transcribeWithAssemblyAI(file, key, opts);
      contabilizar(opts, r, Date.now() - comecou);
      return r;
    } catch (e) {
      log.error("stt.assemblyai", { error: e instanceof Error ? e.message : String(e), diarize: Boolean(opts.diarize) });
    }
  }
  const local = await transcribeWithLocalWhisper(file, opts);
  contabilizar(opts, local, Date.now() - comecou);
  return local;
}

/**
 * Transcrição cobra por SEGUNDO de áudio, não por token: somar isto junto com
 * modelo de texto daria um número sem significado. Sem a duração informada,
 * cai para o fim da última fala, que é uma boa aproximação.
 */
function contabilizar(opts: SttOptions, r: SttResult, duracaoMs: number): void {
  if (!opts.userId) return;
  const ultimaFala = r.utterances?.length ? Math.max(...r.utterances.map((u) => u.endMs)) / 1000 : 0;
  registrarUso({
    userId: opts.userId,
    fluxo: FLUXO.transcricao,
    referencia: opts.referencia,
    servico: r.provider,
    consumo: { unidade: "segundos", entrada: Math.round(r.duracaoS ?? ultimaFala), saida: 0 },
    duracaoMs,
  });
}
