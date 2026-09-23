import type { Consumo } from "./custo";

/**
 * A conta de uma sessão que o SERVIDOR não viu passar.
 *
 * Voz em tempo real e transcrição ao vivo são WebSocket direto do navegador
 * com o Google (é o que mantém a latência baixa: o áudio não dá a volta por
 * aqui). O efeito colateral é que o gasto mais caro da casa era o único sem
 * linha na conta — medido em 22/09/2026: a tela de Gastos somava US$ 0,13 de
 * chat enquanto sessões de voz aconteciam sem deixar rastro.
 *
 * A correção não é trazer o áudio para o servidor (custaria a latência), é o
 * navegador RELATAR o que o provedor cobrou. O provedor manda `usageMetadata`
 * em cada resposta; o cliente acumula e entrega aqui.
 *
 * Este arquivo é puro de propósito: é a parte que decide dinheiro, e decidir
 * dinheiro a partir de número que veio do navegador precisa de teste.
 */

/** O que o cliente relata ao fim (ou durante) uma sessão. Tudo opcional: provedor que não informa um campo não vira zero mentiroso. */
export interface RelatoDeSessao {
  provedor: "gemini" | "openai";
  modelo: string;
  /** tokens de áudio que entraram (microfone) e saíram (fala da Órbita) */
  audioEntrada?: number;
  audioSaida?: number;
  /** tokens de texto: o system prompt, as tools e as transcrições */
  textoEntrada?: number;
  textoSaida?: number;
  /** tokens de imagem, quando a câmera está aberta na sessão */
  videoEntrada?: number;
  /** segundos de áudio, para quem cobra por tempo em vez de por token */
  segundos?: number;
}

export interface LinhaDeSessao {
  servico: string;
  consumo: Consumo;
}

/** O áudio da sessão de voz tem tarifa por provedor, e o `mini` da OpenAI custa um terço do normal. */
function servicoDeAudio(r: RelatoDeSessao): string {
  if (r.provedor === "gemini") return "gemini-live-audio";
  return /mini/i.test(r.modelo) ? "openai-realtime-mini-audio" : "openai-realtime-audio";
}

const positivo = (n: number | undefined): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * Quebra o relato em linhas de conta.
 *
 * Uma linha por TIPO de unidade, não uma por sessão: áudio, texto e vídeo têm
 * preços diferentes na mesma conversa, e somar tudo num campo só esconderia
 * justamente o que o dono precisa ver (foi a câmera aberta que encareceu, ou
 * foi a conversa?). Componente zerado não vira linha: uma sessão sem vídeo não
 * deve deixar "vídeo: US$ 0,00" na tela.
 */
export function linhasDaSessao(r: RelatoDeSessao): LinhaDeSessao[] {
  const linhas: LinhaDeSessao[] = [];

  const audioEntrada = positivo(r.audioEntrada);
  const audioSaida = positivo(r.audioSaida);
  if (audioEntrada || audioSaida) {
    linhas.push({ servico: servicoDeAudio(r), consumo: { unidade: "tokens", entrada: audioEntrada, saida: audioSaida } });
  }

  const textoEntrada = positivo(r.textoEntrada);
  const textoSaida = positivo(r.textoSaida);
  if (textoEntrada || textoSaida) {
    const servico = r.provedor === "gemini" ? "gemini-live-texto" : "openai-realtime-texto";
    linhas.push({ servico, consumo: { unidade: "tokens", entrada: textoEntrada, saida: textoSaida } });
  }

  const video = positivo(r.videoEntrada);
  // o vídeo só tem tarifa própria no Gemini; na OpenAI ele nem existe na sessão
  if (video && r.provedor === "gemini") {
    linhas.push({ servico: "gemini-live-video", consumo: { unidade: "tokens", entrada: video, saida: 0 } });
  }

  const segundos = positivo(r.segundos);
  if (segundos) {
    linhas.push({ servico: "gemini-transcribe-live", consumo: { unidade: "segundos", entrada: segundos, saida: 0 } });
  }

  return linhas;
}
