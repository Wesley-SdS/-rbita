import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/** Erro de URL que aponta para rede interna / não permitida (defesa SSRF). */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/** Converte um IPv4 "a.b.c.d" em inteiro de 32 bits. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = (n << 8) | b;
  }
  return n >>> 0;
}

function inV4Range(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

// Duas faixas de IPv4, separadas de propósito: a segunda (metadata/multicast/
// reservado) é PERIGOSA em qualquer circunstância — nunca ganha exceção, nem
// para a LAN de casa. A primeira (RFC1918 + loopback + CGNAT) é "privada" no
// sentido de rede local; é o que a exceção estreita do Home Assistant libera
// (B3.2), e só para URL configurada pelo dono numa tela confiável, nunca para
// URL vinda de LLM/e-mail/página.
function isLanOrLoopbackV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return (
    inV4Range(n, "0.0.0.0", 8) ||
    inV4Range(n, "10.0.0.0", 8) ||
    inV4Range(n, "100.64.0.0", 10) || // CGNAT
    inV4Range(n, "127.0.0.0", 8) || // loopback
    inV4Range(n, "172.16.0.0", 12) ||
    inV4Range(n, "192.0.0.0", 24) ||
    inV4Range(n, "192.168.0.0", 16) ||
    inV4Range(n, "198.18.0.0", 15)
  );
}
function isAlwaysBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // formato estranho → trata como perigoso
  return (
    inV4Range(n, "169.254.0.0", 16) || // link-local (metadata de nuvem!)
    inV4Range(n, "224.0.0.0", 4) || // multicast
    inV4Range(n, "240.0.0.0", 4) // reservado
  );
}
/** IPv4 privado / loopback / link-local / reservado / CGNAT / metadata. */
function isPrivateV4(ip: string): boolean {
  return isAlwaysBlockedV4(ip) || isLanOrLoopbackV4(ip);
}

const V6_ULA = 0xfc00; // fc00::/7
const V6_LINK_LOCAL = 0xfe80; // fe80::/10
const V6_MULTICAST = 0xff00; // ff00::/8

/** IPv6 loopback / ULA / link-local / não especificado / multicast / IPv4-mapeado. */
function isPrivateV6(ip: string, opts: { allowLan: boolean }): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // remove zone id
  // IPv4-mapeado (::ffff:a.b.c.d) → checa o v4 embutido com a mesma regra
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return opts.allowLan ? isAlwaysBlockedV4(mapped[1]) : isPrivateV4(mapped[1]);

  const first = addr.split(":")[0] ?? "";
  const hi = parseInt(first || "0", 16);
  if (Number.isNaN(hi)) return true;
  if ((hi & 0xff00) === V6_MULTICAST) return true; // sempre bloqueado

  const lanOrLoopback = addr === "::1" || addr === "::" || (hi & 0xfe00) === V6_ULA || (hi & 0xffc0) === V6_LINK_LOCAL;
  return opts.allowLan ? false : lanOrLoopback;
}

function isPrivateIp(ip: string, opts: { allowLan: boolean } = { allowLan: false }): boolean {
  const v = isIP(ip);
  if (v === 4) return opts.allowLan ? isAlwaysBlockedV4(ip) : isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip, opts);
  return true; // não é IP válido → perigoso
}

async function resolveAndCheck(rawUrl: string, opts: { allowLan: boolean }): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SsrfError("URL inválida");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new SsrfError("protocolo não permitido");

  const host = u.hostname.replace(/^\[|\]$/g, ""); // remove colchetes de IPv6
  let ips: string[];
  if (isIP(host)) {
    ips = [host];
  } else {
    try {
      const res = await lookup(host, { all: true });
      ips = res.map((r) => r.address);
    } catch {
      throw new SsrfError("host não resolvido");
    }
  }
  if (!ips.length) throw new SsrfError("host não resolvido");
  for (const ip of ips) {
    if (isPrivateIp(ip, opts)) throw new SsrfError("host aponta para rede interna");
  }
}

/**
 * Garante que a URL é http(s) e resolve para um IP público.
 * Lança SsrfError se apontar para loopback/rede interna/link-local.
 * Mitiga SSRF em fetch dirigido por conteúdo não confiável (LLM/e-mail/página).
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  await resolveAndCheck(rawUrl, { allowLan: false });
}

/**
 * Exceção ESTREITA de SSRF para a rede local (B3.2, CLAUDE.md §9): libera
 * RFC1918/loopback/CGNAT, mas continua bloqueando o que é perigoso em
 * QUALQUER rede (metadata de nuvem 169.254.169.254, multicast, reservado).
 *
 * Só chamar com uma URL que o DONO digitou numa tela de configuração
 * confiável (ex.: endereço do Home Assistant). Nunca com URL vinda de LLM,
 * e-mail, página web ou qualquer conteúdo externo — isso continua proibido,
 * a defesa não foi removida, só ganhou uma porta estreita e explícita.
 */
export async function assertLocalOrPublicUrl(rawUrl: string): Promise<void> {
  await resolveAndCheck(rawUrl, { allowLan: true });
}

/**
 * fetch com defesa SSRF: valida a URL e cada salto de redirecionamento
 * (o alvo do redirect também não pode ser interno). Máx. de redirects limitado.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  let url = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      url = new URL(loc, url).toString();
      continue;
    }
    return res;
  }
  throw new SsrfError("redirecionamentos demais");
}

// exportado para teste
export const _internal = { isPrivateIp };
