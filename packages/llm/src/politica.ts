import { getModelInfo, type ModelInfo } from "./catalog";

/**
 * Quem atende, e o que fazer quando ele não puder.
 *
 * Até aqui isso era UMA chave (`llm.failoverOrder`), e a palavra que importava
 * passava despercebida: era uma ORDEM. Escolher "assinatura" queria dizer
 * "tente a assinatura primeiro" — quando ela recusava, a Órbita ia para o
 * próximo sozinha. Medido em 22/09/2026: com o Claude no limite, um "oi" caiu
 * num modelo local e levou 186 segundos, sem ninguém pedir.
 *
 * O mesmo mecanismo, com o local fora do ar, cai na nuvem PAGA. Ou seja: a
 * casa podia gastar por uso sem ninguém autorizar, justamente contra o que a
 * escolha do dono dizia.
 *
 * Agora são duas decisões separadas: QUEM eu quero, e O QUE FAZER se ele
 * falhar.
 */

/** Como o modelo é cobrado. É por isto que a escolha do dono se orienta. */
export type ClasseDeCobranca = "assinatura" | "local" | "paga";

/** O que fazer quando quem foi escolhido não pôde atender. */
export type QuandoFalhar =
  /** avisa, explica o motivo e espera a pessoa escolher. Nada é gasto sem aval. */
  | "perguntar"
  /** cai para a próxima classe sozinha (o comportamento antigo) */
  | "proximo"
  /** aceita cair, mas só para o que não cobra por uso */
  | "sem_custo";

export function classeDoModelo(m: Pick<ModelInfo, "billing" | "local">): ClasseDeCobranca {
  if (m.billing === "subscription") return "assinatura";
  if (m.local) return "local";
  return "paga";
}

export function classeDaChave(key: string): ClasseDeCobranca | null {
  const info = getModelInfo(key);
  return info ? classeDoModelo(info) : null;
}

/** Rótulo para a pessoa, não para o log. */
export const ROTULO_DA_CLASSE: Record<ClasseDeCobranca, string> = {
  assinatura: "a assinatura",
  local: "um modelo aqui da casa",
  paga: "a nuvem paga",
};

/**
 * Quais classes podem atender este pedido.
 *
 * `preferida` é a escolha do dono. `liberadas` são as que ELE autorizou agora
 * (respondendo à pergunta no chat) — e por isso não dependem da política: se a
 * pessoa disse "pode usar a nuvem", pode usar a nuvem.
 */
export function classesPermitidas(
  preferida: ClasseDeCobranca,
  politica: QuandoFalhar,
  liberadas: ClasseDeCobranca[] = [],
): ClasseDeCobranca[] {
  const set = new Set<ClasseDeCobranca>([preferida, ...liberadas]);
  if (politica === "proximo") return ["assinatura", "local", "paga"];
  // "sem_custo" aceita cair, mas nunca para o que cobra por uso
  if (politica === "sem_custo") {
    set.add("local");
    set.add("assinatura");
  }
  return [...set];
}

/** Filtra a cadeia às classes permitidas, mantendo a ordem que ela já tinha. */
export function filtrarCadeia(cadeia: string[], permitidas: ClasseDeCobranca[]): string[] {
  return cadeia.filter((k) => {
    const c = classeDaChave(k);
    return c !== null && permitidas.includes(c);
  });
}

/**
 * O que dizer à pessoa quando o provedor recusou.
 *
 * Mensagem por CÓDIGO e não por texto do provedor: o corpo do erro vem em
 * inglês, cheio de jargão, e às vezes traz id de requisição. O que ajuda a
 * decidir é saber se é limite, se é crédito ou se é o serviço fora do ar.
 */
export function motivoDaFalha(status: number | undefined, classe: ClasseDeCobranca): string {
  if (status === 429) {
    return classe === "assinatura"
      ? "A assinatura atingiu o limite de uso por enquanto."
      : "O provedor recusou por excesso de pedidos no momento.";
  }
  if (status === 402) return "A conta está sem crédito.";
  if (status === 401 || status === 403) return "A credencial foi recusada (pode ter expirado ou perdido permissão).";
  if (status === 404) return "O modelo escolhido não existe mais nesse provedor.";
  if (status && status >= 500) return "O provedor está fora do ar ou sobrecarregado.";
  if (classe === "local") return "O modelo local não respondeu (o Ollama pode estar desligado).";
  return "Não consegui falar com o provedor.";
}

export interface Alternativa {
  classe: ClasseDeCobranca;
  rotulo: string;
  /** o que isso significa em dinheiro, dito antes de a pessoa escolher */
  custo: string;
}

/**
 * As saídas que existem AGORA, para a pessoa escolher com informação.
 *
 * Cada uma diz o que custa. Oferecer "nuvem paga" sem dizer que cobra seria
 * repetir, com mais passos, o gasto silencioso que isto veio impedir.
 */
export function alternativas(cadeia: string[], jaTentadas: ClasseDeCobranca[]): Alternativa[] {
  const disponiveis = new Set<ClasseDeCobranca>();
  for (const k of cadeia) {
    const c = classeDaChave(k);
    if (c && !jaTentadas.includes(c)) disponiveis.add(c);
  }
  const ordem: ClasseDeCobranca[] = ["assinatura", "local", "paga"];
  return ordem
    .filter((c) => disponiveis.has(c))
    .map((classe) => ({
      classe,
      rotulo: ROTULO_DA_CLASSE[classe],
      custo:
        classe === "assinatura"
          ? "já está pago no plano"
          : classe === "local"
            ? "não custa dinheiro, mas é bem mais lento nesta máquina"
            : "cobra por uso",
    }));
}
