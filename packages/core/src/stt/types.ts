/** Uma fala contígua de um locutor (resultado da diarização). */
export interface SttUtterance {
  /** Rótulo do locutor atribuído pelo provedor ("A", "B", "C"…). */
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
}

/** Resultado normalizado de transcrição (independente do provedor). */
export interface SttResult {
  text: string;
  language: string;
  provider: "assemblyai" | "whisper-local";
  /**
   * Falas separadas por locutor. Só vem quando a diarização foi PEDIDA e o
   * provedor a suporta (hoje: AssemblyAI). Ausente = transcrição corrida.
   */
  utterances?: SttUtterance[];
  /** Quantos locutores distintos foram identificados. */
  speakers?: number;
  /** Duração do áudio em segundos. É a UNIDADE de cobrança da transcrição. */
  duracaoS?: number;
  /**
   * A diarização foi pedida mas não pôde ser feita (ex.: caiu para o whisper
   * local, que não separa vozes). A UI usa isto para avisar em vez de mentir.
   */
  diarizationUnavailable?: boolean;
}

/** Opções de transcrição. */
export interface SttOptions {
  /**
   * Separar as vozes (diarização). Custa mais e só faz sentido em áudio com
   * mais de uma pessoa — reunião, sim; comando de voz, não.
   *
   * ⚠️ Diarização só é coerente sobre o áudio INTEIRO: os rótulos (A, B, C) são
   * atribuídos por requisição, então o "A" de um trecho não é o "A" de outro.
   * Nunca diarize pedaços de uma mesma reunião separadamente.
   */
  diarize?: boolean;
  /** Dica de quantos locutores esperar — melhora a precisão quando conhecido. */
  expectedSpeakers?: number;
  /** De quem é a conta. Sem isto a transcrição fica fora do registro de consumo. */
  userId?: string;
  /** O que está sendo transcrito, para a linha da conta dizer algo ("reunião de terça"). */
  referencia?: string | null;
}
