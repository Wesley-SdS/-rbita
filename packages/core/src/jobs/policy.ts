/**
 * Regras puras da fila. Ficam separadas do banco porque é aqui que mora a
 * decisão: quanto esperar para retentar, o que é falha definitiva e o que é
 * trabalho zumbi. Referência: River, Oban, pg-boss e o artigo de backoff da
 * AWS (full jitter), podados para um worker só.
 */

/**
 * Espera até a próxima tentativa, em ms: `random(0, min(teto, base * 2^n))`.
 *
 * É o "full jitter" da AWS. Com um worker só o efeito de rebanho quase não
 * existe, mas o pouco que existe é real: se o serviço de percepção acabou de
 * reiniciar, três trabalhos pendentes retentando no mesmo instante derrubam de
 * novo um serviço que ainda está carregando modelo.
 */
export function proximaEspera(tentativas: number, baseMs: number, tetoMs: number, aleatorio: () => number = Math.random): number {
  const expoente = Math.min(tentativas, 20); // 2^20 já satura qualquer teto
  const janela = Math.min(tetoMs, baseMs * 2 ** Math.max(0, expoente));
  return Math.floor(aleatorio() * janela);
}

export type DecisaoDeFalha = "retentar" | "desistir";

/**
 * Erro permanente não volta para a fila: validação, arquivo corrompido, falta
 * de consentimento e 4xx vão falhar de novo igual, e retentar só queima CPU e
 * atrasa a resposta ao dono.
 */
export function decidirFalha(tentativas: number, maxTentativas: number, permanente: boolean): DecisaoDeFalha {
  if (permanente) return "desistir";
  return tentativas < maxTentativas ? "retentar" : "desistir";
}

/**
 * Trabalho "rodando" que ninguém está tocando: o processo que o pegou morreu.
 *
 * O sinal é o coração, e o coração é do RUNNER, não do handler: ele bate num
 * relógio próprio enquanto o trabalho executa. Se dependesse do progresso do
 * handler, uma única chamada longa de LLM (minutos na CPU, sem nada para
 * relatar no meio) pararia o coração e o trabalho VIVO seria declarado zumbi e
 * executado duas vezes. É o risco que o Oban documenta no rescue por tempo.
 *
 * O que esta instância está executando agora nunca é zumbi, por construção.
 *
 * De propósito, "outra instância" NÃO é zumbi na hora: o `tsx watch` deixa o
 * processo velho e o novo vivos juntos por alguns segundos, e recuperar na
 * hora rodaria o mesmo trabalho em paralelo. O processo velho que morreu de
 * verdade para de bater, e o prazo o pega.
 */
export function ehZumbi(
  j: { id: string; heartbeatAt: Date | null; startedAt: Date | null },
  emExecucao: ReadonlySet<string>,
  paradoMs: number,
  agora: Date,
): boolean {
  if (emExecucao.has(j.id)) return false;
  const ultimoSinal = j.heartbeatAt ?? j.startedAt;
  if (!ultimoSinal) return true;
  return agora.getTime() - ultimoSinal.getTime() > paradoMs;
}

/** De quanto em quanto tempo o runner bate o coração: um terço do prazo, com teto. */
export function intervaloDeBatimento(paradoMs: number, tetoMs = 30_000): number {
  return Math.max(1_000, Math.min(tetoMs, Math.floor(paradoMs / 3)));
}

/** Estado terminal: não roda mais, e pode ter o anexo apagado. */
export function ehTerminal(status: string): boolean {
  return status === "feito" || status === "falhou" || status === "cancelado";
}

/**
 * Mensagem curta em pt-BR para a tela. O detalhe técnico vai para o log; o que
 * o dono lê precisa dizer o que aconteceu e, quando dá, o que fazer.
 */
export function mensagemDeErro(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e);
  return bruto.trim().slice(0, 300) || "Falhou sem dizer o motivo.";
}
