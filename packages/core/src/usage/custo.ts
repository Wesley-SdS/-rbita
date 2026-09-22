import { getModelInfo, type ProviderId } from "@orbita/llm";

/**
 * Quanto custou UMA chamada. Puro: recebe o que foi consumido, devolve o
 * dinheiro e como ele é cobrado.
 *
 * Existe separado do registro porque é a parte que erra fácil e que precisa
 * de teste: preço de entrada e de saída são diferentes, assinatura não é
 * grátis mas também não custa por chamada, e provedor que não informa preço
 * não pode virar custo zero — que foi o bug que já derrubou a ordem do
 * failover uma vez (RV.2).
 */

/** Como o gasto chega na fatura. Não é o mesmo que "quanto". */
export type Cobranca = "assinatura" | "uso" | "local" | "gratis";

export interface Consumo {
  /** tokens | segundos | caracteres | paginas | requisicoes */
  unidade: string;
  entrada: number;
  saida: number;
  /** parte da entrada que veio do cache do provedor (cobra menos, quando cobra) */
  entradaCache?: number;
}

export interface PrecoUnitario {
  /** USD por 1k unidades de entrada */
  entrada?: number;
  /** USD por 1k unidades de saída */
  saida?: number;
}

/**
 * Preço dos serviços que NÃO são modelo de texto e por isso não estão no
 * catálogo descoberto. Valores de referência públicos de setembro/2026, em
 * USD. São default de engenharia: quem quiser precisão põe o preço do próprio
 * contrato na tela (as chaves `usage.preco*`).
 *
 * O Piper e o Whisper local ficam em zero porque rodam na máquina: o custo
 * deles é energia, que o painel de economia já estima à parte.
 */
export const PRECO_SERVICOS: Record<string, { preco: PrecoUnitario; cobranca: Cobranca; unidade: string }> = {
  // US$ 0,27 por hora de áudio = 0,000075 por segundo = 0,075 por 1k segundos
  assemblyai: { preco: { entrada: 0.075 }, cobranca: "uso", unidade: "segundos" },
  "whisper-local": { preco: {}, cobranca: "local", unidade: "segundos" },
  piper: { preco: {}, cobranca: "local", unidade: "caracteres" },
  // TTS do Gemini: cobrado como token de saída de áudio
  "gemini-tts": { preco: { saida: 0.01 }, cobranca: "uso", unidade: "caracteres" },
  // OCR local (tesseract) não custa nada além da máquina
  tesseract: { preco: {}, cobranca: "local", unidade: "paginas" },
  // Embedding de nuvem: ~US$ 0,15 por 1M tokens, e um token são ~4 caracteres,
  // logo ~0,0000375 por 1k caracteres.
  "embedding-nuvem": { preco: { entrada: 0.0000375 }, cobranca: "uso", unidade: "caracteres" },
  "embedding-local": { preco: {}, cobranca: "local", unidade: "caracteres" },
};

/** Como o provedor cobra, quando é um modelo do catálogo. */
export function cobrancaDoProvedor(provider: ProviderId | string): Cobranca {
  if (provider === "local") return "local";
  if (provider === "claude") return "assinatura";
  return "uso";
}

/**
 * O custo em USD de uma chamada.
 *
 * Assinatura devolve ZERO de propósito, e a tela mostra isso como "coberto
 * pela assinatura" em vez de esconder: o plano é pago de qualquer jeito, e
 * fingir que aquelas chamadas foram de graça daria a impressão errada de que
 * usar mais a assinatura não tem limite (tem, e ele aparece como 429).
 */
export function custoDaChamada(consumo: Consumo, preco: PrecoUnitario, cobranca: Cobranca): number {
  if (cobranca !== "uso") return 0;
  const entradaPaga = Math.max(0, consumo.entrada - (consumo.entradaCache ?? 0));
  const custo = (entradaPaga / 1000) * (preco.entrada ?? 0) + (consumo.saida / 1000) * (preco.saida ?? 0);
  return Number.isFinite(custo) ? Math.max(0, custo) : 0;
}

/**
 * Preço de um modelo do catálogo descoberto.
 *
 * Provedor que não informa preço devolve `{}` — e o custo sai zero, mas a
 * chamada FICA REGISTRADA com a contagem de tokens. A tela então consegue
 * dizer "3 mil chamadas sem preço informado" em vez de somar zero e parecer
 * que não houve gasto.
 */
export function precoDoModelo(modelKey: string): { preco: PrecoUnitario; cobranca: Cobranca; precoConhecido: boolean } {
  const info = getModelInfo(modelKey);
  const cobranca = cobrancaDoProvedor(info?.provider ?? modelKey.split("/")[0]);
  if (!info || cobranca !== "uso") return { preco: {}, cobranca, precoConhecido: cobranca !== "uso" };
  const preco: PrecoUnitario = { entrada: info.costPer1kInput, saida: info.costPer1k || undefined };
  return { preco, cobranca, precoConhecido: preco.entrada !== undefined || preco.saida !== undefined };
}

/** Preço de um serviço que não é modelo de texto (transcrição, voz, OCR). */
export function precoDoServico(servico: string): { preco: PrecoUnitario; cobranca: Cobranca; unidade: string } {
  return PRECO_SERVICOS[servico] ?? { preco: {}, cobranca: "uso", unidade: "requisicoes" };
}
