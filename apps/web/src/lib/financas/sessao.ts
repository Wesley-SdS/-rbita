/**
 * Estado da tela lembrado por SESSÃO (PRD §4.6): aba, mês, filtros, sub-aba e
 * meta aberta. Recarregar a página volta exatamente onde estava; fechar a aba
 * do navegador esquece. `sessionStorage` pode não existir ou recusar (aba
 * privada, cota), e nada disso pode quebrar a tela: falha vira o padrão.
 */

type Armazem = Pick<Storage, "getItem" | "setItem">;

function armazem(): Armazem | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function lerSessao<T extends object>(chave: string, padrao: T, onde: Armazem | null = armazem()): T {
  try {
    const bruto = onde?.getItem(chave);
    if (!bruto) return padrao;
    const lido = JSON.parse(bruto) as unknown;
    // só aproveita o que tem o mesmo formato: um estado velho de outra versão
    // da tela não pode derrubar a nova
    if (!lido || typeof lido !== "object" || Array.isArray(lido)) return padrao;
    return { ...padrao, ...(lido as Partial<T>) };
  } catch {
    return padrao;
  }
}

export function gravarSessao(chave: string, valor: unknown, onde: Armazem | null = armazem()): void {
  try {
    onde?.setItem(chave, JSON.stringify(valor));
  } catch {
    /* cota cheia ou armazenamento bloqueado: lembrar é conveniência, não requisito */
  }
}
