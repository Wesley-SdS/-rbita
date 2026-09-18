import { enrollFromMeetingRef, identifyMeetingSpeakers, linkUnknownVoicesToMeeting, recomputeVoiceSignatures, type RecomputeProgress } from "./voice";
import { recomputeFaceSignatures } from "./face";
import { eraseBiometrics } from "./erase";

/**
 * FACHADA de identidade para quem fala com nuvem (tools, resumo de reunião,
 * fila de trabalho).
 *
 * A cerca do NV.1 (PRD §4.9) proíbe `tools/**` de importar os módulos
 * biométricos (`identity/voice`, `identity/face`): é lá que vivem vetores e
 * amostras, e é o caminho que fala com modelo de nuvem. As tools precisam
 * apenas DISPARAR operações, nunca ver biometria, então passam por aqui, onde
 * só entram e saem identificadores e mensagens.
 *
 * Regra para quem mexer nisto: nada nesta fachada pode devolver vetor, amostra,
 * recorte ou áudio. Se precisar disso, não é uma operação de tool.
 */

/** Usa uma fala já transcrita como amostra de voz de alguém (com consentimento). */
export async function usarFalaComoAmostra(ownerUserId: string, personId: string, ref: string, origem: "reuniao" | "correcao" | "comando"): Promise<{ ok: true } | { erro: string }> {
  try {
    await enrollFromMeetingRef(ownerUserId, personId, ref, origem);
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não consegui usar essa fala como amostra." };
  }
}

/**
 * Liga os "Desconhecido N" de uma reunião ao documento dela. Quem chama é o
 * resumo de reunião, que manda a transcrição para o modelo (às vezes de nuvem):
 * por isso ele passa por aqui. Entram só rótulos e o id; sai uma contagem.
 */
export async function ligarDesconhecidosAReuniao(ownerUserId: string, rotulos: readonly string[], documentId: string): Promise<number> {
  return linkUnknownVoicesToMeeting(ownerUserId, rotulos, documentId);
}

/**
 * Quem é quem numa reunião já transcrita (VZ.5). O áudio ENTRA aqui (vai só
 * para o serviço local de percepção) e o que sai são rótulos, nomes, confiança
 * e uma referência efêmera: nenhum vetor. É o caminho do módulo de reuniões,
 * que também manda a transcrição para o modelo (às vezes de nuvem).
 */
export async function identificarLocutoresDaReuniao(
  ownerUserId: string,
  audio: Uint8Array,
  mime: string,
  utterances: Parameters<typeof identifyMeetingSpeakers>[3],
  sourceRef: string | null,
) {
  return identifyMeetingSpeakers(ownerUserId, audio, mime, utterances, sourceRef);
}

/** Recalcula as assinaturas de voz (troca de modelo). Devolve só contagens. */
export async function recalcularAssinaturasDeVoz(ownerUserId: string, progresso?: RecomputeProgress) {
  return recomputeVoiceSignatures(ownerUserId, progresso);
}

/** Recalcula as assinaturas de rosto (troca de backend). Devolve só contagens. */
export async function recalcularAssinaturasDeRosto(ownerUserId: string, progresso?: RecomputeProgress) {
  return recomputeFaceSignatures(ownerUserId, progresso);
}

/** Apaga toda a biometria de alguém. Devolve só o que foi limpo, sem nenhum dado. */
export async function apagarBiometriaDe(ownerUserId: string, personId: string): Promise<{ tabelas: string[]; referencias: string[] }> {
  return eraseBiometrics(ownerUserId, personId);
}
