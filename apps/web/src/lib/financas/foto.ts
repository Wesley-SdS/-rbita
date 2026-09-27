/**
 * Fotos de referência dos itens de meta (PRD §7.12). A foto é reduzida NO
 * NAVEGADOR antes de subir: uma foto de celular tem 4 a 8 MB, e o servidor
 * só precisa de algo que se reconheça numa miniatura de 78 px ou na tela
 * cheia de um celular.
 */

export const LADO_MAXIMO = 900;
export const QUALIDADE_JPEG = 0.62;
export const MAX_POR_SELECAO = 6;
export const TAMANHO_MAXIMO = 25 * 1024 * 1024;

/** Dimensões finais mantendo a proporção; foto menor que o limite não é ampliada. */
export function dimensoesReduzidas(largura: number, altura: number, lado = LADO_MAXIMO): { largura: number; altura: number } {
  if (!(largura > 0) || !(altura > 0)) throw new Error("Imagem sem dimensões.");
  const escala = Math.min(1, lado / Math.max(largura, altura));
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) };
}

/**
 * O que da seleção vai ser processado: só imagens, no máximo 6, e nada acima
 * de 25 MB (um arquivo desses trava o celular ao decodificar e ninguém tira
 * foto de referência desse tamanho).
 */
export function escolherFotos<T extends { size: number; type: string }>(arquivos: readonly T[]): T[] {
  return arquivos.filter((a) => a.type.startsWith("image/") && a.size <= TAMANHO_MAXIMO).slice(0, MAX_POR_SELECAO);
}
