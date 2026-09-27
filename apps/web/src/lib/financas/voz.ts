/**
 * O que dizer quando o ditado por voz falha (PRD §8.1.2). O reconhecimento é
 * o Web Speech do navegador (`lib/voice/speech.ts`), que só devolve um código
 * de erro; a pessoa precisa de uma frase que diga o que fazer.
 */

export type FalhaDeVoz =
  /** permissão negada ou sem microfone: o botão vira a faixa do teclado */
  | { tipo: "bloqueado" }
  /** algo passageiro: continua o botão, com um recado embaixo */
  | { tipo: "recado"; texto: string }
  /** parada pedida (abort): não é erro */
  | { tipo: "nada" };

export function falhaDeVoz(codigo: string): FalhaDeVoz {
  switch (codigo) {
    case "not-allowed":
    case "service-not-allowed":
    case "audio-capture":
      return { tipo: "bloqueado" };
    case "no-speech":
      return { tipo: "recado", texto: "Não ouvi nada, toque e fale de novo" };
    case "aborted":
      return { tipo: "nada" };
    default:
      return { tipo: "recado", texto: "Não consegui ouvir, escreva abaixo" };
  }
}

/**
 * O texto do campo enquanto a pessoa fala: o que já estava escrito, mais o
 * que foi reconhecido até agora (§8.1.2, "somado ao que já estava escrito").
 */
export function juntarDitado(antes: string, ouvido: string): string {
  const a = antes.trimEnd();
  const b = ouvido.trim();
  if (!b) return antes;
  return a ? `${a} ${b}` : b;
}
