/** Resultado normalizado de transcrição (independente do provedor). */
export interface SttResult {
  text: string;
  language: string;
  provider: "assemblyai" | "whisper-local";
}
