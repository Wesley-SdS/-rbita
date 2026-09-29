/**
 * Entidades HTML num texto que vai para a tela ou para o modelo. PURA.
 *
 * Saiu de `tools/web.ts` porque o Gmail também devolve o `snippet` escapado:
 * o aviso de e-mail importante mostrava "couldn&#39;t" no sino (28/09/2026).
 */

/** Código de caractere que não existe ("&#99999999;") fica como veio, em vez de derrubar a página inteira. */
function caractere(codigo: number, original: string): string {
  try {
    return String.fromCodePoint(codigo);
  } catch {
    return original;
  }
}

export function decodificarEntidades(s: string): string {
  return (
    s
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      // entidade numérica ("&#92;" no título da Anthropic, "&#x2F;")
      .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => caractere(parseInt(h, 16), m))
      .replace(/&#(\d+);/g, (m, d: string) => caractere(Number(d), m))
      // &amp; POR ÚLTIMO: primeiro, "&amp;lt;" (texto literal "&lt;") viraria "<"
      .replace(/&amp;/g, "&")
  );
}
