/**
 * BIOMETRIA NUNCA SAI DE CASA (PRD §4.1), como defesa em RUNTIME e não só como
 * convenção.
 *
 * Todo tráfego com dado biométrico (amostra de voz, recorte de rosto, vetor)
 * sai marcado pelo cabeçalho `x-orbita-biometria` (o cliente do serviço de
 * percepção marca sempre). O guard embrulha o `fetch` global do processo: uma
 * requisição marcada para um host que não é local é recusada ANTES de sair,
 * com erro e log. O teste `no-leak.test.ts` cobre o guard e verifica, no código,
 * que módulo de biometria não importa provedor de nuvem e vice-versa.
 */

export const BIOMETRIC_HEADER = "x-orbita-biometria";

export class BiometricEgressError extends Error {
  constructor(public readonly host: string) {
    super(`Bloqueado: dado biométrico não pode sair para ${host}`);
    this.name = "BiometricEgressError";
  }
}

const PRIVADO_V4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];
// as faixas privadas só valem para IP LITERAL: "10.evil.com" ou
// "127.0.0.1.nip.io" são nomes DNS públicos que começam parecido
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Host da própria casa: loopback, rede privada, .local, ou o host do Docker. Puro. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h === "host.docker.internal" || h.endsWith(".local") || h.endsWith(".lan")) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h) || h.startsWith("fe80:")) return true;
  if (IPV4_LITERAL.test(h)) return PRIVADO_V4.some((r) => r.test(h));
  // nome sem ponto (ex.: "perception" num compose) só resolve na rede local
  return !h.includes(".") && !h.includes(":");
}

/** A URL aponta para dentro de casa? Falha fechada para URL inválida. */
export function isLocalUrl(url: string): boolean {
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function headerMarcado(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  if (headers instanceof Headers) return headers.has(BIOMETRIC_HEADER);
  if (Array.isArray(headers)) return headers.some(([k]) => k.toLowerCase() === BIOMETRIC_HEADER);
  return Object.keys(headers).some((k) => k.toLowerCase() === BIOMETRIC_HEADER);
}

/** A requisição carrega biometria (pelo cabeçalho, no init ou no Request)? */
export function isBiometricRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (headerMarcado(init?.headers)) return true;
  return typeof Request !== "undefined" && input instanceof Request && input.headers.has(BIOMETRIC_HEADER);
}

function urlDe(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Embrulha um fetch: biometria para fora de casa é recusada. Puro sobre o fetch recebido. */
export function guardFetch(inner: typeof fetch, onBlock?: (host: string) => void): typeof fetch {
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isBiometricRequest(input, init)) {
      const url = urlDe(input);
      if (!isLocalUrl(url)) {
        let host = url;
        try {
          host = new URL(url).host;
        } catch {
          // URL inválida: o próprio texto serve de identificação no erro
        }
        onBlock?.(host);
        throw new BiometricEgressError(host);
      }
      // redirect reenviaria a amostra para outro host sem nova checagem
      return inner(input, { ...init, redirect: "error" });
    }
    return inner(input, init);
  }) as typeof fetch;
  return guarded;
}

let instalado = false;

/** Instala o guard no `fetch` global do processo (chamado no boot do apps/api). Idempotente. */
export function installBiometricEgressGuard(onBlock?: (host: string) => void): void {
  if (instalado) return;
  globalThis.fetch = guardFetch(globalThis.fetch.bind(globalThis), onBlock);
  instalado = true;
}
