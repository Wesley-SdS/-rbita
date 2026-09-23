/**
 * Cabeçalhos de segurança do app (lidos pelo next.config).
 *
 * CSP: o que a página pode carregar e com quem pode falar. O mapa do que a
 * Órbita usa fora da própria origem (conferido no código em 18/09/2026):
 *   - o WebSocket da palavra de ativação (`VOICE_PUBLIC_WS_URL`);
 *   - a OpenAI no modo de voz em tempo real (`lib/voice/realtime.ts`);
 *   - `data:` e `blob:` para áudio da fala, snapshot de câmera e webcam.
 * As fontes vêm do próprio Next (next/font), não do Google em tempo real.
 *
 * O que ainda é permissivo, de propósito: `script-src 'unsafe-inline'`, porque
 * o Next injeta scripts inline de inicialização e tirar isso exige nonce por
 * requisição (middleware + renderização dinâmica). Mesmo assim a CSP fecha o
 * que mais importa aqui: para onde dado pode SAIR (`connect-src`), plugin
 * (`object-src`), quem pode embutir a página (`frame-ancestors`), `<base>` e
 * destino de formulário.
 *
 * `CSP_MODE` (enforce | report-only | off) existe para o dia em que um recurso
 * novo for bloqueado: dá para diagnosticar sem tirar a proteção do resto.
 */

export interface CspOpcoes {
  dev: boolean;
  /** URL do WebSocket de ativação por voz (VOICE_PUBLIC_WS_URL), se houver */
  voiceWs?: string | null;
  /** origens extras separadas por vírgula (CSP_CONNECT_EXTRA) */
  extraConnect?: string | null;
}

/** Só a origem (esquema + host + porta) de uma URL; lixo vira null. Puro. */
export function origemDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function buildCsp(o: CspOpcoes): string {
  // Destinos do modo de voz em tempo real: o navegador fala DIRETO com o
  // provedor (é o que mantém a latência baixa), então a CSP precisa liberar
  // exatamente esses dois e nada mais. WebRTC na OpenAI, WebSocket no Gemini.
  const connect = new Set<string>(["'self'", "https://api.openai.com", "wss://generativelanguage.googleapis.com"]);
  const ws = origemDe(o.voiceWs);
  if (ws) connect.add(ws);
  for (const extra of (o.extraConnect ?? "").split(",")) {
    const e = origemDe(extra);
    if (e) connect.add(e);
  }
  // em dev o Next usa eval (react-refresh) e WebSocket para o hot reload
  if (o.dev) connect.add("ws:").add("wss:");

  const diretivas: Record<string, string[]> = {
    "default-src": ["'self'"],
    // `wasm-unsafe-eval` é o que deixa o WebAssembly compilar. Sem ele o
    // detector de fala (silero, em .wasm) morre silenciosamente em produção e
    // a voz cai para a energia sem ninguém entender por quê. Ele NÃO libera
    // `eval` de JavaScript: é a permissão estreita, feita para este caso.
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(o.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "media-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [...connect],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
  };
  return Object.entries(diretivas)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

/**
 * HSTS só quando o app é servido em HTTPS de verdade (BETTER_AUTH_URL): em
 * http o navegador ignora, e ligar num domínio errado prende o navegador em
 * HTTPS por meses. Sem `includeSubDomains`: o domínio da casa pode ter outras
 * coisas que não são a Órbita.
 */
export function hstsValue(baseUrl: string | undefined, maxAgeEnv: string | undefined): string | null {
  if (!baseUrl?.trim().toLowerCase().startsWith("https://")) return null;
  const maxAge = Number(maxAgeEnv);
  const segundos = Number.isInteger(maxAge) && maxAge >= 0 ? maxAge : 15_552_000; // 180 dias
  return segundos > 0 ? `max-age=${segundos}` : null;
}

export function securityHeaders(env: Record<string, string | undefined>, dev: boolean): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    // microfone e câmera só para a própria Órbita (voz, reunião, cadastro de
    // rosto); o resto dos sensores fica desligado
    { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()" },
  ];
  const modo = (env.CSP_MODE ?? "enforce").trim().toLowerCase();
  if (modo !== "off") {
    const csp = buildCsp({ dev, voiceWs: env.VOICE_PUBLIC_WS_URL, extraConnect: env.CSP_CONNECT_EXTRA });
    headers.push({ key: modo === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", value: csp });
  }
  const hsts = hstsValue(env.BETTER_AUTH_URL, env.HSTS_MAX_AGE);
  if (hsts) headers.push({ key: "Strict-Transport-Security", value: hsts });
  return headers;
}
