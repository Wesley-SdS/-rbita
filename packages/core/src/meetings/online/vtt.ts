/**
 * Transcrição em WebVTT (Teams e Zoom entregam assim) → "Nome: fala", uma
 * linha por vez que alguém fala. PURA.
 *
 * O Teams marca quem fala com `<v Nome>texto</v>`; o Zoom põe "Nome: texto" na
 * linha. As falas seguidas da mesma pessoa viram uma só: legenda quebra a fala
 * a cada poucos segundos, e o resumo não precisa de quarenta linhas "Wesley:".
 */

export interface Fala {
  quem: string | null;
  texto: string;
}

const TEMPO = /^\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s+-->/;

function lerLinha(linha: string): Fala | null {
  const l = linha.trim();
  if (!l) return null;
  const voz = /^<v(?:\.[^ >]*)?\s+([^>]+)>(.*?)(?:<\/v>)?$/.exec(l);
  if (voz) return { quem: voz[1].trim(), texto: tirarTags(voz[2]) };
  // "Nome: texto" do Zoom. Nome curto e sem cara de frase: ponto seguido de
  // minúscula ("importante. prazo: sexta") é frase, não pessoa; ponto de
  // abreviação ("Dr. João", "Wesley S. Santos") é nome
  const zoom = /^([^:!?]{1,60}):\s+(.+)$/.exec(l);
  if (zoom && !/\.\s+[a-zà-ÿ]/.test(zoom[1])) return { quem: zoom[1].trim(), texto: tirarTags(zoom[2]) };
  return { quem: null, texto: tirarTags(l) };
}

const tirarTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export function falasDoVtt(vtt: string): Fala[] {
  const falas: Fala[] = [];
  for (const bloco of vtt.replace(/\r/g, "").split(/\n\s*\n/)) {
    const linhas = bloco.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!linhas.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(linhas[0])) continue;
    // o número da legenda (ou um id qualquer) vem antes da linha do tempo
    const i = linhas.findIndex((l) => TEMPO.test(l));
    if (i < 0) continue;
    for (const l of linhas.slice(i + 1)) {
      const f = lerLinha(l);
      if (f?.texto) falas.push(f);
    }
  }
  return juntarFalas(falas);
}

/** Falas seguidas da mesma pessoa viram uma. */
export function juntarFalas(falas: readonly Fala[]): Fala[] {
  const out: Fala[] = [];
  for (const f of falas) {
    const ultima = out[out.length - 1];
    if (ultima && ultima.quem === f.quem) ultima.texto = `${ultima.texto} ${f.texto}`;
    else out.push({ ...f });
  }
  return out;
}

/** O texto que vai para o resumo, no mesmo formato da reunião gravada ("Nome: fala"). */
export function textoDasFalas(falas: readonly Fala[]): string {
  return falas.map((f) => (f.quem ? `${f.quem}: ${f.texto}` : f.texto)).join("\n");
}
