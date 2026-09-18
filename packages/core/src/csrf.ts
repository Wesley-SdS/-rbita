/**
 * Anti-CSRF nas rotas que ALTERAM dados (POST, PUT, PATCH, DELETE) do apps/api.
 *
 * O Better Auth já protege as rotas de login com a lista de origens de
 * `auth-origins.ts`. As rotas da Órbita não tinham nada além do cookie
 * SameSite=Lax. Esta é a segunda camada, com a MESMA lista de origens (uma
 * política só, em vez de duas que divergem com o tempo).
 *
 * Duas regras, as duas baseadas no que o navegador manda sem o site poder
 * forjar:
 *   - `Sec-Fetch-Site: cross-site`: é outro site pedindo. Recusa;
 *   - `Origin` presente e fora da lista de confiança. Recusa.
 * Sem `Origin` e sem `Sec-Fetch-Site` o pedido não veio de navegador: é o app
 * mobile, o webhook do Frigate ou um script. Passa, e a rota continua exigindo
 * sessão ou token como sempre.
 *
 * `Origin: null` (o app mobile já foi visto mandando isso) só passa sem
 * `Sec-Fetch-Site`: navegador que manda `null` (iframe isolado, arquivo local)
 * sempre manda também o `Sec-Fetch-Site`, e aí cai na primeira regra.
 */

const SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface PedidoOrigem {
  method: string;
  origin: string | null;
  secFetchSite: string | null;
  confiaveis: readonly string[];
}

/** Devolve o motivo da recusa, ou null quando o pedido pode seguir. Puro. */
export function motivoRecusaOrigem(p: PedidoOrigem): string | null {
  if (SEGUROS.has(p.method.toUpperCase())) return null;
  if (p.secFetchSite === "cross-site") return "pedido de outro site";
  if (!p.origin) return null;
  if (p.origin === "null") return p.secFetchSite ? "origem nula vinda de navegador" : null;
  const limpa = p.origin.trim().replace(/\/+$/, "");
  return p.confiaveis.includes(limpa) ? null : "origem não confiável";
}
