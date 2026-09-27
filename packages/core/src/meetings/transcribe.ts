import { transcribeAudio } from "../stt/index";
import type { SttResult, SttUtterance } from "../stt/types";
import { getOwnerId } from "../owner";
import { log } from "../observability/logger";
// pela fachada: este módulo manda o áudio para a transcrição, que pode ser de
// nuvem (escolha do dono, PRD §4.3), e a cerca do NV.1 não deixa ele importar
// o módulo de voz
import { identificarLocutoresDaReuniao } from "../identity/actions";

/**
 * Transcrição de uma GRAVAÇÃO inteira, com quem é quem. É o mesmo caminho para
 * o `/api/stt` (ditado de comando e app mobile, imediato) e para a fila de
 * reunião (longa, em segundo plano): uma lógica só, dois jeitos de esperar.
 */

export type Progresso = (feito: number, total: number | null, passo: string) => Promise<void>;

export type SpeakerIdentities = Awaited<ReturnType<typeof identificarLocutoresDaReuniao>>;

export interface TranscricaoResultado extends SttResult {
  speakerIdentities?: SpeakerIdentities;
}

export interface TranscreverOpcoes {
  diarize?: boolean;
  expectedSpeakers?: number;
  /** documento da reunião, quando já existe (liga o "Desconhecido N" à origem) */
  sourceRef?: string | null;
  /** o que está sendo transcrito, para a linha da conta dizer algo */
  referencia?: string | null;
}

export async function transcribeRecording(userId: string, audio: Uint8Array, mime: string, opts: TranscreverOpcoes, progresso?: Progresso): Promise<TranscricaoResultado> {
  const diarize = Boolean(opts.diarize);
  const total = diarize ? 2 : 1;
  await progresso?.(0, total, "transcrevendo o áudio");
  const started = Date.now();
  // cópia para um ArrayBuffer próprio: o File não aceita visão sobre buffer compartilhado
  const file = new File([new Uint8Array(audio)], "gravacao", { type: mime });
  const result = await transcribeAudio(file, { diarize, expectedSpeakers: opts.expectedSpeakers, userId, referencia: opts.referencia ?? null });
  log.info("stt", { userId, provider: result.provider, diarize, speakers: result.speakers ?? 0, bytes: audio.length, ms: Date.now() - started });

  // Nomes dos locutores (VZ.5): a diarização foi sobre o áudio INTEIRO; aqui só
  // se calcula uma assinatura por etiqueta, LOCALMENTE. Só para o dono (pessoas
  // e biometria são da casa dele). Fail-soft: sem o serviço de percepção, a
  // reunião sai como antes ("Locutor A").
  if (!diarize || !result.utterances?.length || (await getOwnerId()) !== userId) return result;
  await progresso?.(1, total, "reconhecendo quem falou");
  const t = Date.now();
  const speakerIdentities = await identificarLocutoresDaReuniao(userId, audio, mime, result.utterances, opts.sourceRef ?? null).catch((e) => {
    log.warn("stt.locutores_falhou", { error: e instanceof Error ? e.message : String(e) });
    return undefined;
  });
  if (!speakerIdentities) return result;
  log.info("stt.locutores", { reconhecidos: speakerIdentities.filter((s) => s.outcome === "identificado").length, total: speakerIdentities.length, ms: Date.now() - t });
  return { ...result, speakerIdentities };
}

/**
 * Etiqueta de diarização → nome da pessoa, só para quem foi reconhecido COM
 * CONFIANÇA.
 *
 * "provavelmente o Lucas" fica de fora de propósito (§5.4.2: identidade nunca
 * afirma sem confiança). Escrever "Lucas:" numa transcrição com base num palpite
 * seria pôr na boca de alguém o que ele talvez não tenha dito — e essa
 * transcrição vai para o resumo, para as tarefas e para a memória da casa. Na
 * dúvida, continua "Locutor B", e a tela pede o nome ao dono.
 */
export function nomesDosLocutores(identities: SpeakerIdentities | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of identities ?? []) {
    if (s.outcome === "identificado" && s.name?.trim()) out[s.label] = s.name.trim();
  }
  return out;
}

/**
 * Texto que vai para o resumo: com os rótulos de locutor quando houve
 * diarização, trocados pelo NOME de quem foi reconhecido.
 *
 * O nome não é enfeite. O modelo extraía compromissos com responsável
 * "Locutor A", e "Locutor A" não é o nome de ninguém: a regra que decide se a
 * tarefa é sua (`ehMeu`) recusa rótulo de diarização, então o que o dono ficou
 * de fazer não virava tarefa dele. A tela já mostrava o nome; quem nunca o via
 * era justamente o modelo.
 */
export function textoDaTranscricao(r: { text?: string; utterances?: SttUtterance[] }, nomes: Record<string, string> = {}): string {
  if (r.utterances?.length) {
    return r.utterances.map((u) => `${nomes[u.speaker]?.trim() || `Locutor ${u.speaker}`}: ${u.text}`).join("\n");
  }
  return (r.text ?? "").trim();
}

/** Rótulos "Desconhecido N" criados nesta transcrição, para ligar à reunião depois. Puro. */
export function desconhecidosDaTranscricao(r: { speakerIdentities?: { unknownLabel: string | null }[] }): string[] {
  return (r.speakerIdentities ?? []).map((s) => s.unknownLabel).filter((l): l is string => Boolean(l));
}
