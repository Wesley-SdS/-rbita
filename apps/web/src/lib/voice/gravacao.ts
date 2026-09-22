/**
 * A gravação tem som suficiente para valer uma transcrição?
 *
 * Existe por um caso real (22/09/2026): uma reunião foi encerrada com **315
 * bytes** de áudio — um cabeçalho WebM sem nenhum quadro de som. A guarda de
 * então só barrava `size === 0`, então aquilo subiu, virou um trabalho de fila,
 * gastou uma transcrição paga na AssemblyAI e voltou vazio. A pessoa recebeu
 * "A transcrição voltou vazia", que descreve o sintoma e não ajuda em nada.
 *
 * Conferir ANTES de enviar é mais barato e mais honesto: dá para dizer o que
 * aconteceu enquanto a pessoa ainda lembra do que fez.
 */

/**
 * Piso de tamanho. WebM/Opus de voz fica por volta de 3 KB por segundo, então
 * abaixo disto não cabe nem um segundo de fala. Não é config do dono: é
 * propriedade do formato, não uma preferência.
 */
export const BYTES_MINIMOS = 2048;

/** Piso de duração. Menos que isso não é reunião, é clique sem querer. */
export const SEGUNDOS_MINIMOS = 1;

export type AvaliacaoGravacao = { vale: true } | { vale: false; recado: string };

export function avaliarGravacao(bytes: number, segundos: number): AvaliacaoGravacao {
  if (!bytes) {
    return { vale: false, recado: "Não chegou som nenhum. Confira se o microfone está liberado e tente de novo." };
  }
  if (segundos < SEGUNDOS_MINIMOS) {
    return { vale: false, recado: "A gravação durou menos de um segundo. Comece a ouvir e fale um pouco antes de encerrar." };
  }
  if (bytes < BYTES_MINIMOS) {
    return {
      vale: false,
      recado: "A gravação ficou muda: chegou o arquivo, mas sem som dentro. Costuma ser o microfone errado escolhido no navegador.",
    };
  }
  return { vale: true };
}
