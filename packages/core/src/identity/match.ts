/**
 * CASAMENTO BIOMÉTRICO puro (voz agora, rosto na Onda 10): vetor novo contra as
 * assinaturas cadastradas, por cosseno. Sem banco e sem modelo: testável.
 *
 * Nunca afirma sem confiança (PRD §7): acima do limiar e com folga sobre o
 * segundo colocado é "identificado"; entre o limiar de "provável" e o de
 * identificação, ou sem folga, é "provável"; abaixo, "desconhecido". Os três
 * números são chaves de config, calibradas pela medição com a biometria real.
 */

export type MatchOutcome = "identificado" | "provavel" | "desconhecido";

/**
 * Tentativas de criar um rótulo "Desconhecido N" único. Duas pessoas novas
 * aparecendo no mesmo segundo colidem no índice único; mais que isto não é
 * concorrência, é bug em outro lugar.
 */
export const TENTATIVAS_ROTULO_UNICO = 5;

export interface Signature {
  personId: string;
  /** vetores de cadastro da pessoa, todos do MESMO modelo do vetor consultado */
  vectors: number[][];
}

export interface MatchConfig {
  /** cosseno mínimo para afirmar quem é */
  threshold: number;
  /** cosseno mínimo para dizer "provavelmente" */
  probableThreshold: number;
  /** folga mínima sobre a segunda pessoa mais parecida (parentes, vozes próximas) */
  margin: number;
  /** abaixo desta quantidade de fala, nunca "identificado" (fala curta identifica mal) */
  minSpeechSeconds?: number;
}

export interface MatchResult {
  outcome: MatchOutcome;
  personId: string | null;
  score: number;
  /** melhor escore de OUTRA pessoa (para a UI mostrar ambiguidade) */
  runnerUp: { personId: string; score: number } | null;
  reason?: "fala_curta" | "sem_folga" | "abaixo_do_limiar" | "sem_cadastro";
}

export function normalize(v: readonly number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n === 0 ? [...v] : v.map((x) => x / n);
}

export function cosineSim(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`dimensões diferentes (${a.length} × ${b.length}): vetores de modelos distintos não se comparam`);
  const na = normalize(a);
  const nb = normalize(b);
  let s = 0;
  for (let i = 0; i < na.length; i++) s += na[i]! * nb[i]!;
  return s;
}

/** Centroide normalizado das amostras de uma pessoa. */
export function centroid(vectors: readonly (readonly number[])[]): number[] {
  if (!vectors.length) throw new Error("sem vetores");
  const dim = vectors[0]!.length;
  const acc = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    const n = normalize(v);
    for (let i = 0; i < dim; i++) acc[i]! += n[i]!;
  }
  return normalize(acc);
}

export function matchSignature(query: readonly number[], signatures: readonly Signature[], cfg: MatchConfig, speechSeconds?: number): MatchResult {
  const ranking = signatures
    .filter((s) => s.vectors.length)
    .map((s) => ({ personId: s.personId, score: cosineSim(query, centroid(s.vectors)) }))
    .sort((a, b) => b.score - a.score);

  const [melhor, segundo] = ranking;
  if (!melhor) return { outcome: "desconhecido", personId: null, score: 0, runnerUp: null, reason: "sem_cadastro" };
  const runnerUp = segundo ? { personId: segundo.personId, score: segundo.score } : null;

  if (melhor.score < cfg.probableThreshold) return { outcome: "desconhecido", personId: null, score: melhor.score, runnerUp, reason: "abaixo_do_limiar" };

  const curta = speechSeconds !== undefined && cfg.minSpeechSeconds !== undefined && speechSeconds < cfg.minSpeechSeconds;
  const semFolga = runnerUp !== null && melhor.score - runnerUp.score < cfg.margin;
  if (melhor.score >= cfg.threshold && !curta && !semFolga) return { outcome: "identificado", personId: melhor.personId, score: melhor.score, runnerUp };

  return {
    outcome: "provavel",
    personId: melhor.personId,
    score: melhor.score,
    runnerUp,
    reason: curta ? "fala_curta" : semFolga ? "sem_folga" : "abaixo_do_limiar",
  };
}
