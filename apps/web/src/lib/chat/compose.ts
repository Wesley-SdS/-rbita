/**
 * PromptComposer (padrão aprendido da Adalink, versão enxuta): o system prompt
 * não é uma string concatenada — é montado de "chunks" tipados com PRIORIDADE e
 * um orçamento. Se estourar o orçamento, os chunks compressíveis de menor
 * prioridade são cortados primeiro, preservando segurança > ferramentas > persona.
 *
 * Prioridades (maior = mais importante, nunca cortado antes dos menores):
 *   130 segurança/identidade · 100 persona base · 90 contexto temporal
 *   70 skills ativas · 50 RAG/contexto do usuário
 */
export interface Chunk {
  content: string;
  priority: number;
  compressible?: boolean; // pode ser cortado se faltar orçamento
}

/** Compõe o system a partir dos chunks, respeitando um orçamento de caracteres. */
export function composeSystem(chunks: Chunk[], budgetChars = 12000): string {
  const valid = chunks.filter((c) => c.content && c.content.trim());
  // ordena por prioridade desc; empate mantém a ordem de inserção (estável)
  const ordered = valid.map((c, i) => ({ c, i })).sort((a, b) => b.c.priority - a.c.priority || a.i - b.i);

  const kept: { c: Chunk; i: number }[] = [];
  let used = 0;
  for (const item of ordered) {
    const len = item.c.content.length;
    if (used + len <= budgetChars || !item.c.compressible) {
      kept.push(item);
      used += len;
    }
    // chunk compressível que não cabe é descartado (corte gracioso)
  }
  // reemite na ordem original de inserção (leitura natural do prompt)
  return kept.sort((a, b) => a.i - b.i).map((x) => x.c.content).join("");
}
