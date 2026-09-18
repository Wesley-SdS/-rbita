/**
 * Regras puras do acompanhamento de tarefa (PRD §5.4, "me ajuda com essa
 * receita"). Ficam separadas porque são a parte que decide, e decisão precisa
 * de teste sem câmera, sem banco e sem modelo.
 */

/** Passou tempo suficiente desde a última olhada? */
export function devoOlhar(lastLookAt: Date | null, intervalSeconds: number, agora: Date): boolean {
  if (!lastLookAt) return true;
  return agora.getTime() - lastLookAt.getTime() >= intervalSeconds * 1000;
}

export type Veredito = "terminou" | "ainda_nao" | "nao_da_para_saber";

/**
 * Interpreta a resposta do modelo de visão sobre o passo atual.
 *
 * O modelo local é pequeno (moondream e parecidos) e responde em prosa mesmo
 * quando você pede SIM ou NÃO, então a leitura é tolerante. Na dúvida o
 * veredito é "não dá para saber", NUNCA "terminou": avançar sozinho um passo
 * que não aconteceu é pior do que ficar quieto e olhar de novo.
 */
export function lerVeredito(resposta: string): Veredito {
  const t = resposta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (!t) return "nao_da_para_saber";
  // "não dá para saber", "não consigo ver", "a imagem está escura"
  if (/\bnao (da|consigo|deu|e possivel)\b|nao sei|escur|borrad|nao aparece|nao vejo|impossivel/.test(t)) return "nao_da_para_saber";
  // negativa antes da afirmativa: "não, ainda está batendo"
  if (/^nao\b|\bainda nao\b|\bnao terminou\b|\bnao acabou\b|\bem andamento\b|\bfazendo\b|\bainda esta\b/.test(t)) return "ainda_nao";
  if (/^sim\b|\bterminou\b|\bja (esta|foi) (pronto|feito)\b|\bconcluid|\bacabou\b|\bfinalizad|\bpronto\b/.test(t)) return "terminou";
  return "nao_da_para_saber";
}

/** Pergunta feita à câmera sobre o passo atual. `modelo` vem da config. */
export function montarPergunta(modelo: string, passo: string, titulo: string): string {
  return modelo.replaceAll("{passo}", passo).replaceAll("{tarefa}", titulo);
}

export interface AvancoResultado {
  /** próximo índice, ou o total quando acabou */
  proximo: number;
  concluiu: boolean;
  texto: string | null;
}

/** Avança um passo e diz o que falar. Puro. */
export function avancar(steps: readonly string[], atual: number): AvancoResultado {
  const proximo = atual + 1;
  if (proximo >= steps.length) return { proximo: steps.length, concluiu: true, texto: null };
  return { proximo, concluiu: false, texto: steps[proximo] ?? null };
}

/**
 * Limpa e limita os passos que o modelo (ou o dono) mandou: sem vazio, sem
 * passo quilométrico e sem lista infinita. Teto vem da config.
 */
export function normalizarPassos(passos: readonly string[], maxPassos: number, maxChars = 300): string[] {
  return passos
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((p) => (p.length > maxChars ? p.slice(0, maxChars - 1) + "…" : p))
    .slice(0, maxPassos);
}
