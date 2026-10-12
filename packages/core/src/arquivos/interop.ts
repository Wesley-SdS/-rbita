/**
 * Biblioteca CommonJS importada de ESM chega de jeitos diferentes conforme quem
 * carrega: o Node puro (o `tsx` do apps/api) entrega `module.exports` inteiro
 * em `default`, o vitest às vezes já espalha os nomes. O `cfb` (UMD) e o
 * `@kenjiuno/msgreader` (TS compilado com `exports.default`) caem nesse vão:
 * `CFB.read` existia no teste e era `undefined` no processo vivo.
 *
 * Isto procura o membro pedido em todos os níveis de `default`.
 */
export function membro<T>(mod: unknown, chave: string): T {
  let atual: unknown = mod;
  for (let i = 0; i < 3 && atual; i++) {
    if (typeof atual === "object" || typeof atual === "function") {
      if (chave in (atual as Record<string, unknown>)) return (atual as Record<string, T>)[chave]!;
      atual = (atual as { default?: unknown }).default;
    } else break;
  }
  throw new Error(`Biblioteca sem "${chave}": instalação incompleta?`);
}

/** O valor exportado como padrão (classe ou função), desembrulhando `default` de CommonJS. */
export function padrao<T>(mod: unknown): T {
  let atual: unknown = mod;
  for (let i = 0; i < 3; i++) {
    const d = (atual as { default?: unknown } | null)?.default;
    if (typeof atual === "function" && !d) return atual as T;
    if (d === undefined) return atual as T;
    atual = d;
  }
  return atual as T;
}
