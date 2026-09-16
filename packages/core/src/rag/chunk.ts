/** Divide texto em janelas com sobreposição (preserva contexto). */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    // tenta cortar num limite de parágrafo/frase próximo
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const cut = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (cut > size * 0.5) end = i + cut + 1;
    }
    chunks.push(clean.slice(i, end).trim());
    i = end - overlap;
    if (end >= clean.length) break;
  }
  return chunks.filter(Boolean);
}
