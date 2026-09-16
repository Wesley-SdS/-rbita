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

/** Estima tokens de um texto (~4 chars/token; heurística boa o suficiente p/ orçar
 *  o system). Evita depender de um tokenizador pesado no caminho de request. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compõe o system a partir dos chunks, respeitando um orçamento em TOKENS
 * (estimados). Chunks compressíveis de menor prioridade são cortados primeiro,
 * preservando segurança > ferramentas > persona. ~3200 tokens ≈ o antigo teto
 * de 12k chars, mas agora a unidade é a que o modelo realmente consome.
 */
export function composeSystem(chunks: Chunk[], budgetTokens = 3200): string {
  const valid = chunks.filter((c) => c.content && c.content.trim());
  // ordena por prioridade desc; empate mantém a ordem de inserção (estável)
  const ordered = valid.map((c, i) => ({ c, i })).sort((a, b) => b.c.priority - a.c.priority || a.i - b.i);

  const kept: { c: Chunk; i: number }[] = [];
  let used = 0;
  for (const item of ordered) {
    const t = estimateTokens(item.c.content);
    if (used + t <= budgetTokens || !item.c.compressible) {
      kept.push(item);
      used += t;
    }
    // chunk compressível que não cabe é descartado (corte gracioso)
  }
  // reemite na ordem original de inserção (leitura natural do prompt)
  return kept.sort((a, b) => a.i - b.i).map((x) => x.c.content).join("");
}
