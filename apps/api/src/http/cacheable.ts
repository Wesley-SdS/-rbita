import { createHash } from "node:crypto";
import { settings } from "@orbita/core/settings/index";

/**
 * Resposta de LEITURA cacheável: `ETag` + `Cache-Control`, e 304 quando o
 * navegador já tem exatamente esta versão.
 *
 * Por que ETag e não só `max-age`: as duas coisas resolvem problemas
 * diferentes. O `max-age` evita a viagem enquanto o dado é novo; o ETag evita
 * o CORPO depois que ele vence. Uma lista de entidades do Home Assistant tem
 * dezenas de kB de JSON repetitivo que quase nunca muda, então o 304 vale
 * mais que o max-age.
 *
 * `private` + `Vary: Cookie` porque toda resposta aqui é do dono: nenhuma
 * delas pode encostar num cache compartilhado (o Caddy na frente, em
 * produção).
 *
 * O tempo vem de `cache.leituraMaxAgeS` (tela em Ajustes), não de constante:
 * quem decide o equilíbrio entre instantâneo e fresco é o dono (§5.6). Zero
 * desliga o `max-age` e mantém só a revalidação por ETag, que continua sendo
 * um ganho grande e sem risco de ver dado velho.
 */
export async function leituraCacheavel(req: Request, dados: unknown, opts: { maxAgeS?: number } = {}): Promise<Response> {
  const corpo = JSON.stringify(dados ?? null);
  const etag = etagDe(corpo);

  // Falha de banco não pode derrubar uma leitura: sem config, vale o default.
  const maxAge = opts.maxAgeS ?? (await settings.get("cache.leituraMaxAgeS").catch(() => 30));

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    ETag: etag,
    Vary: "Cookie",
    "Cache-Control":
      maxAge > 0
        ? // `stale-while-revalidate`: passado o max-age, o navegador ainda pode
          // pintar a tela com o guardado enquanto revalida atrás.
          `private, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`
        : "private, no-cache",
  };

  if (casaComEtag(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(corpo, { status: 200, headers });
}

/** ETag forte do corpo. sha1 e não sha256: aqui é impressão digital, não defesa. */
export function etagDe(corpo: string): string {
  return `"${createHash("sha1").update(corpo).digest("base64url")}"`;
}

/**
 * O `If-None-Match` casa com o nosso ETag?
 *
 * O cabeçalho pode trazer vários valores separados por vírgula, `*`, e a marca
 * `W/` de validador fraco (alguns proxies acrescentam ao comprimir). Comparar
 * a string inteira, como é tentador, faria o 304 nunca acontecer atrás de um
 * proxy que comprime.
 */
export function casaComEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const limpo = (v: string) => v.trim().replace(/^W\//, "");
  const meu = limpo(etag);
  return ifNoneMatch.split(",").some((v) => {
    const c = limpo(v);
    return c === "*" || c === meu;
  });
}
