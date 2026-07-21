/**
 * Origens confiáveis (anti-CSRF do Better Auth). Módulo puro (sem dependência de
 * banco) para poder ser testado isolado.
 *
 * Além do baseURL, confia em: localhost, IPs da REDE LOCAL (o app mobile acessa
 * o backend pelo IP do PC, ex.: http://192.168.x.x:3000 — origem diferente que
 * sem isso é rejeitada), `TRUSTED_ORIGINS` (lista por vírgula) e o PRÓPRIO host
 * da requisição (same-origin, seguro contra CSRF — ver `trustedOrigins`).
 */

const LAN_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

/** Remove barra final: o Better Auth compara origens como string exata. */
export const cleanOrigin = (u: string) => u.trim().replace(/\/+$/, "");

export function trustedOrigins(request?: Request): string[] {
  const list = new Set<string>(["http://localhost:3000", "http://127.0.0.1:3000"]);
  if (process.env.BETTER_AUTH_URL) list.add(cleanOrigin(process.env.BETTER_AUTH_URL));
  // Vercel: a MESMA app responde por vários domínios (produção, branch e cada
  // deploy). Estas variáveis são fornecidas pela Vercel — quando expostas.
  for (const host of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ]) {
    if (host) list.add(`https://${cleanOrigin(host)}`);
  }
  for (const o of (process.env.TRUSTED_ORIGINS ?? "").split(",").map(cleanOrigin).filter(Boolean)) list.add(o);

  const origin = request?.headers.get("origin");
  if (origin && LAN_ORIGIN.test(origin)) list.add(origin);

  // Same-origin é sempre seguro contra CSRF: numa requisição legítima o Origin
  // é igual ao host acessado; num CSRF o Origin vem de outro site (≠ Host). Por
  // isso confiamos no PRÓPRIO host da requisição — cobre todos os domínios da
  // Vercel sem depender das variáveis VERCEL_* (que podem não estar expostas no
  // runtime, o que causava "Invalid origin" no domínio de produção).
  const host = request?.headers.get("host");
  if (host) {
    const proto = request?.headers.get("x-forwarded-proto") ?? (LAN_ORIGIN.test(`http://${host}`) ? "http" : "https");
    list.add(cleanOrigin(`${proto}://${host}`));
  }
  return [...list];
}
