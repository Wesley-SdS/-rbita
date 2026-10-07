/**
 * O texto que a seleção por relevância usa para escolher as tools do turno.
 *
 * Era só a mensagem atual, e pedido de CONTINUAÇÃO não traz o assunto: depois
 * de "quais são as minhas tarefas", o dono disse "atualize essa do fornecedor,
 * o nome é Melhor do Grão" e a Órbita respondeu que não tinha ferramenta de
 * tarefas (05/10/2026). Nenhuma palavra daquela frase casava com `editar_tarefa`,
 * e a seleção a deixou de fora. O assunto estava na mensagem anterior.
 *
 * Por isso entram também as últimas `turnos` mensagens da conversa (do dono e
 * da Órbita: a resposta "você tem três tarefas" carrega o assunto tanto quanto a
 * pergunta). A atual vai primeiro e é o que pesa no empate, porque a seleção
 * conta palavras e não posição. Puro.
 */
export function consultaDasTools(
  atual: string,
  historico: readonly { role: string; content: unknown }[],
  turnos: number,
): string {
  if (turnos <= 0) return atual;
  const anteriores = historico
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-turnos)
    .map((m) => m.content as string);
  return [atual, ...anteriores].join("\n");
}
