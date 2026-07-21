/**
 * Quebra o texto da resposta em blocos faláveis, para o TTS começar a tocar o
 * 1º trecho enquanto os seguintes ainda são sintetizados.
 *
 * ⚠️ Cópia fiel de `apps/web/src/lib/voice/engine.ts` (`splitFala`). O mobile é
 * standalone (não importa dos packages), então a lógica vive aqui também; se
 * mudar num lado, atualize o outro. Coberto por `split-fala.test.mjs`.
 */

// Medido no Gemini TTS: sintetizar custa ~1 s por segundo de áudio gerado.
// Com o Edge é bem mais rápido, mas o desenho segue valendo: 1º trecho curto
// (a fala começa logo) e os seguintes maiores.
const PRIMEIRO_CH = 45;
const MIN_CH = 80;
const MAX_CH = 200;

export function splitFala(text: string): string[] {
  const frases = text.match(/[^.!?…\n]+[.!?…\n]*/g) ?? [text];
  const out: string[] = [];
  let buf = "";

  const empurra = () => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = "";
  };
  const alvo = () => (out.length === 0 ? PRIMEIRO_CH : MIN_CH);

  for (const frase of frases) {
    if (buf.length + frase.length <= MAX_CH) {
      buf += frase;
      if (buf.length >= alvo()) empurra();
      continue;
    }
    empurra();
    if (frase.length <= MAX_CH) {
      buf = frase;
      continue;
    }
    // frase gigante sem pontuação final: parte nas vírgulas
    let resto = frase;
    while (resto.length > MAX_CH) {
      const corte = resto.lastIndexOf(",", MAX_CH);
      const at = corte > MIN_CH ? corte + 1 : MAX_CH;
      out.push(resto.slice(0, at).trim());
      resto = resto.slice(at);
    }
    buf = resto;
  }
  empurra();

  // O 1º trecho manda na latência: se uma frase longa o inflou, corta na vírgula.
  if (out[0] && out[0].length > PRIMEIRO_CH * 1.5) {
    const virgula = out[0].lastIndexOf(",", PRIMEIRO_CH + 20);
    if (virgula > 15) {
      const cabeca = out[0].slice(0, virgula + 1).trim();
      const cauda = out[0].slice(virgula + 1).trim();
      if (cauda) out.splice(0, 1, cabeca, cauda);
    }
  }

  return out.filter(Boolean);
}
