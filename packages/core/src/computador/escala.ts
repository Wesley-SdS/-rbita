/**
 * COORDENADAS DA TAREFA DELEGADA NO WINDOWS (PRD-MOTOR-DESKTOP §7.3).
 *
 * O Claude responde em pixels DA IMAGEM que recebeu. Quem converte para o pixel
 * físico (DPI de cada monitor, origem do desktop virtual) são as mãos, que
 * guardam a escala de cada captura pelo id. Por isso o motor não tem aritmética
 * de DPI: ele só nunca mistura pontos de capturas diferentes, e recusa o ponto
 * que cai fora da imagem em vez de deixar as mãos clicarem num canto qualquer.
 *
 * Puro.
 */

export interface CapturaVista {
  id: string;
  largura: number;
  altura: number;
}

/** O que a API aceita de imagem: 2576 px no lado maior e cerca de 3,75 MP (doc de computer use). */
const LADO_MAX = 2576;
const PIXELS_MAX = 3_750_000;

export function imagemCabe(largura: number, altura: number): boolean {
  return Math.max(largura, altura) <= LADO_MAX && largura * altura <= PIXELS_MAX;
}

/** Quanto reduzir para a imagem caber (1 se já cabe). */
export function fatorParaCaber(largura: number, altura: number): number {
  if (imagemCabe(largura, altura)) return 1;
  return Math.min(LADO_MAX / Math.max(largura, altura), Math.sqrt(PIXELS_MAX / (largura * altura))) * 0.98;
}

const ehNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `[x, y]` do Claude (ou `{x, y}`) → inteiros, ou null. */
export function lerPonto(v: unknown): [number, number] | null {
  if (Array.isArray(v) && v.length === 2 && ehNumero(v[0]) && ehNumero(v[1])) return [Math.round(v[0]), Math.round(v[1])];
  if (v && typeof v === "object" && ehNumero((v as { x?: unknown }).x) && ehNumero((v as { y?: unknown }).y)) {
    const o = v as { x: number; y: number };
    return [Math.round(o.x), Math.round(o.y)];
  }
  return null;
}

export type Alvo = { captura: string; x: number; y: number };
export type RegiaoDoZoom = { captura: string; x0: number; y0: number; x1: number; y1: number };

/** O ponto do Claude como alvo `{captura, x, y}` da última imagem, ou a frase do erro. */
export function pontoNaCaptura(v: unknown, cap: CapturaVista | null): Alvo | { erro: string } {
  if (!cap) return { erro: "Ainda não há captura da tela. Peça um screenshot antes de apontar." };
  const p = lerPonto(v);
  if (!p) return { erro: "Ponto inválido: use [x, y] em pixels do último screenshot." };
  const [x, y] = p;
  if (x < 0 || y < 0 || x >= cap.largura || y >= cap.altura) return { erro: `O ponto (${x}, ${y}) está fora do screenshot (${cap.largura}x${cap.altura}).` };
  return { captura: cap.id, x, y };
}

/** A região do zoom, em pixels do último screenshot, ordenada e dentro da imagem. */
export function regiaoDoZoom(v: unknown, cap: CapturaVista | null): RegiaoDoZoom | { erro: string } {
  if (!cap) return { erro: "Ainda não há captura da tela. Peça um screenshot antes do zoom." };
  if (!Array.isArray(v) || v.length !== 4 || !v.every(ehNumero)) return { erro: "Região inválida: use [x0, y0, x1, y1] em pixels do último screenshot." };
  const [a, b, c, d] = v as number[];
  const x0 = Math.max(0, Math.min(a!, c!));
  const y0 = Math.max(0, Math.min(b!, d!));
  const x1 = Math.min(cap.largura, Math.max(a!, c!));
  const y1 = Math.min(cap.altura, Math.max(b!, d!));
  if (x1 - x0 < 8 || y1 - y0 < 8) return { erro: "A região do zoom é pequena demais (mínimo 8x8 pixels)." };
  return { captura: cap.id, x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) };
}
