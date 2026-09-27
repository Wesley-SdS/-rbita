/**
 * Quais serviços de casa a Órbita USA na configuração atual. Puro.
 *
 * O health dizia `ollama: down` numa casa que tinha escolhido não usar o
 * Ollama, e um painel de saúde que acusa falha em algo que ninguém usa ensina
 * o dono a ignorar o painel (E6 do PRD-SEM-OLLAMA). Serviço que nenhum caminho
 * usa aparece como "nao_usado", e só o que é usado pode estar "down".
 */

export type EstadoServico = "up" | "down" | "nao_usado";

export interface UsoDoOllama {
  /** a descoberta pergunta ao Ollama (`deveDescobrirLocal`) */
  politicaUsaLocal: boolean;
  /** existe Ollama alcançável daqui (`localAvailable`) */
  alcancavel: boolean;
  embeddingsProvider: string;
  temChaveDeEmbedding: boolean;
  ocrVisionProvider: string;
  temChaveDeNuvem: boolean;
}

/** Algum caminho vai ao Ollama? Chat, embedding ou leitura de página. */
export function ollamaEmUso(u: UsoDoOllama): boolean {
  if (!u.alcancavel) return false;
  if (u.politicaUsaLocal) return true;
  // embedding em auto sem chave de nuvem cai no local (embeddings.ts)
  if (u.embeddingsProvider === "local" || (u.embeddingsProvider === "auto" && !u.temChaveDeEmbedding)) return true;
  // OCR: só "local" e o auto sem chave vão ao Ollama; "nuvem" sem chave não cai mais para ele (E5)
  return u.ocrVisionProvider === "local" || (u.ocrVisionProvider === "auto" && !u.temChaveDeNuvem);
}

export interface UsoDaVozLocal {
  /** `TTS_PROVIDER`: auto põe o Piper como último degrau */
  ttsProvider: string;
  /** `voice.wakeEngine`: auto e vosk usam o serviço local */
  wakeEngine: string;
  /** sem AssemblyAI, a transcrição cai para o whisper local */
  temChaveDeTranscricao: boolean;
}

/**
 * O `apps/voice` (Piper, Vosk, whisper) é usado? Em auto ele é a reserva de
 * tudo, então conta como usado: se cair, a reserva sumiu e isso é notícia.
 */
export function vozLocalEmUso(u: UsoDaVozLocal): boolean {
  const ttsSemPiper = u.ttsProvider === "edge" || u.ttsProvider === "gemini";
  return !(ttsSemPiper && u.wakeEngine === "navegador" && u.temChaveDeTranscricao);
}

/** Estado final de um serviço: não usado nem é pingado como falha. */
export function estadoDoServico(emUso: boolean, respondeu: boolean): EstadoServico {
  if (!emUso) return "nao_usado";
  return respondeu ? "up" : "down";
}
