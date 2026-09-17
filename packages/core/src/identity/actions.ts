import { enrollFromMeetingRef } from "./voice";
import { eraseBiometrics } from "./erase";

/**
 * FACHADA de identidade para o caminho do LLM (tools).
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

/** Apaga toda a biometria de alguém. Devolve só o que foi limpo, sem nenhum dado. */
export async function apagarBiometriaDe(ownerUserId: string, personId: string): Promise<{ tabelas: string[]; referencias: string[] }> {
  return eraseBiometrics(ownerUserId, personId);
}
