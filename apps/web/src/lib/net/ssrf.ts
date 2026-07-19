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

/** IPv4 privado / loopback / link-local / reservado / CGNAT / metadata. */
function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // formato estranho → trata como perigoso
  return (
    inV4Range(n, "0.0.0.0", 8) ||
    inV4Range(n, "10.0.0.0", 8) ||
    inV4Range(n, "100.64.0.0", 10) || // CGNAT
    inV4Range(n, "127.0.0.0", 8) || // loopback
    inV4Range(n, "169.254.0.0", 16) || // link-local (metadata cloud!)
    inV4Range(n, "172.16.0.0", 12) ||
    inV4Range(n, "192.0.0.0", 24) ||
    inV4Range(n, "192.168.0.0", 16) ||
    inV4Range(n, "198.18.0.0", 15) ||
    inV4Range(n, "224.0.0.0", 4) || // multicast
    inV4Range(n, "240.0.0.0", 4) // reservado
  );
}

/** IPv6 loopback / ULA / link-local / não especificado / multicast / IPv4-mapeado. */
function isPrivateV6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // remove zone id
  if (addr === "::1" || addr === "::") return true;
  // IPv4-mapeado (::ffff:a.b.c.d) → checa o v4 embutido
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  const first = addr.split(":")[0] ?? "";
  const hi = parseInt(first || "0", 16);
  if (Number.isNaN(hi)) return true;
  if ((hi & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((hi & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((hi & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true; // não é IP válido → perigoso
}

/**
 * Garante que a URL é http(s) e resolve para um IP público.
 * Lança SsrfError se apontar para loopback/rede interna/link-local.
 * Mitiga SSRF em fetch dirigido por conteúdo não confiável (LLM/e-mail/página).
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
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
    if (isPrivateIp(ip)) throw new SsrfError("host aponta para rede interna");
  }
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
