/**
 * CATEGORIAS DE SITE BLOQUEADAS (PRD B2), mapeadas para endereços reais.
 *
 * O dono escolhe as categorias na tela (`navegador.categoriasBloqueadas`); aqui
 * fica o que cada uma QUER DIZER na prática. A lista de bancos não mora aqui:
 * é a mesma de E-mails (`emails.bancos`), para o dono cadastrar um banco uma
 * vez só. Site de categoria bloqueada vence qualquer linha de `navegador_site`
 * (um "escrita" cadastrado por engano para o banco continua bloqueado).
 *
 * Puro: a extensão recebe a lista pronta (`dominiosBloqueados`) e repete a
 * checagem do lado dela, e o core confere de novo antes de qualquer texto ir
 * ao modelo.
 */

export const CATEGORIAS = ["bancos", "senhas", "webmail", "contas", "navegador", "orbita"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/**
 * Categorias que NÃO saem da lista, mesmo que o dono as desmarque na tela (I-1
 * da auditoria): sem `orbita`, o modelo abria a fila de aprovação da própria
 * Órbita no Chrome e clicava em "Aprovar" por CDP. A tela mostra só as
 * editáveis.
 */
export const CATEGORIAS_FIXAS: readonly Categoria[] = ["orbita"];
export const CATEGORIAS_EDITAVEIS = CATEGORIAS.filter((c) => !CATEGORIAS_FIXAS.includes(c));

/**
 * Bancos e carteiras de pagamento por endereço de INTERNET BANKING, além dos
 * remetentes de `emails.bancos` (que são domínios de e-mail e deixavam de fora
 * `banco.bradesco`, o PayPal e o Mercado Pago). É o padrão editável da chave
 * `navegador.sitesDeBanco`; "internetbanking.*" vale para qualquer domínio que
 * comece assim.
 */
export const BANCOS_PADRAO: readonly string[] = [
  "banco.bradesco", "bradesco.com.br", "itau.com.br", "bb.com.br", "caixa.gov.br", "santander.com.br", "nubank.com.br", "bancointer.com.br", "inter.co",
  "c6bank.com.br", "sicredi.com.br", "sicoob.com.br", "bancobrasil.com.br", "btgpactual.com", "xpi.com.br", "mercadopago.com.br", "mercadopago.com",
  "picpay.com", "pagseguro.uol.com.br", "pagbank.com.br", "paypal.com", "wise.com", "internetbanking.*",
];

/**
 * Portas em que a própria Órbita responde nesta máquina: web, api, a ponte do
 * WhatsApp, voz, percepção e as mãos do Windows. Qualquer endereço de loopback
 * (localhost, 127.x, [::1], 0.0.0.0) nelas é a Órbita, e endereço de rede
 * privada nas portas do `dev:rede` (web e api) também.
 */
export const PORTAS_DA_ORBITA: readonly number[] = [3000, 3010, 3011, 8001, 8002, 8003];
const PORTAS_DA_REDE: readonly number[] = [3000, 3010];

/** Domínios (e os subdomínios deles) de cada categoria fixa. */
export const DOMINIOS_DA_CATEGORIA: Record<Exclude<Categoria, "bancos" | "orbita" | "navegador">, readonly string[]> & { navegador: readonly string[] } = {
  // gerenciadores de senha (a página do cofre, não o site institucional inteiro quando dá para separar)
  senhas: [
    "1password.com", "1password.eu", "1password.ca", "lastpass.com", "bitwarden.com", "bitwarden.eu", "dashlane.com", "keepersecurity.com", "keepersecurity.eu",
    "nordpass.com", "passwords.google.com", "passwords.google", "roboform.com", "enpass.io", "pass.proton.me", "zoho.com/vault", "app.zoho.com",
  ],
  // webmail: o e-mail tem conector com permissão própria, e foi pelo e-mail aberto no navegador que o Comet vazou código de uso único
  webmail: [
    "mail.google.com", "inbox.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "outlook.com", "hotmail.com", "mail.yahoo.com",
    "mail.proton.me", "proton.me", "mail.zoho.com", "mail.aol.com", "icloud.com", "mail.uol.com.br", "email.uol.com.br", "webmail.terra.com.br", "mail.bol.com.br",
  ],
  // páginas de conta: é onde se troca senha, recuperação e segundo fator
  contas: [
    "myaccount.google.com", "accounts.google.com", "security.google.com", "myactivity.google.com", "admin.google.com", "pay.google.com", "payments.google.com",
    "account.microsoft.com", "login.microsoftonline.com", "login.microsoft.com", "login.live.com", "account.live.com", "mysignins.microsoft.com", "myaccount.microsoft.com",
    "admin.microsoft.com", "appleid.apple.com", "account.apple.com", "id.atlassian.com", "github.com/settings",
  ],
  // a loja de extensões: instalar extensão é dar a alguém o navegador inteiro
  navegador: ["chromewebstore.google.com", "chrome.google.com/webstore", "microsoftedge.microsoft.com/addons", "addons.mozilla.org"],
};

/** Esquemas que nunca são página de terceiro comum: são o próprio navegador ou o disco. */
export const ESQUEMAS_DO_NAVEGADOR = ["chrome:", "chrome-extension:", "chrome-untrusted:", "devtools:", "edge:", "view-source:", "file:", "filesystem:", "javascript:", "data:", "blob:"] as const;

export interface ContextoDeBloqueio {
  categorias: readonly string[];
  /** `emails.bancos` */
  bancos: readonly string[];
  /** onde a própria Órbita responde ("localhost:3000", "orbita.minhacasa.com") */
  origensDaOrbita: readonly string[];
  /** as portas da Órbita na máquina (padrão `PORTAS_DA_ORBITA`, mais as do ambiente) */
  portasDaOrbita?: readonly number[];
}

/** "https://WWW.Itau.com.br/x" → { host: "itau.com.br", hostComPorta: "itau.com.br", caminho: "/x" }. Puro. */
export function partesDaUrl(url: string): { esquema: string; host: string; hostComPorta: string; caminho: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return { esquema: u.protocol, host, hostComPorta: u.port ? `${host}:${u.port}` : host, caminho: u.pathname.toLowerCase() };
}

/** "itau.com.br" cobre "www.itau.com.br" e "cartoes.itau.com.br"; "github.com/settings" cobre só esse caminho. Puro. */
export function casaDominio(alvo: { host: string; hostComPorta: string; caminho: string }, padrao: string): boolean {
  const p = padrao.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^\*\./, "").replace(/^www\./, "");
  if (!p) return false;
  const barra = p.indexOf("/");
  const hostP = barra >= 0 ? p.slice(0, barra) : p;
  const caminhoP = barra >= 0 ? p.slice(barra) : "";
  // "internetbanking.*": qualquer domínio que comece com esse rótulo (internetbanking.caixa.gov.br, internetbanking.bb.com.br)
  if (hostP.endsWith(".*")) {
    const prefixo = hostP.slice(0, -1);
    if (prefixo.length < 3 || !alvo.host.startsWith(prefixo)) return false;
    return !caminhoP || alvo.caminho.startsWith(caminhoP);
  }
  const hostAlvo = hostP.includes(":") ? alvo.hostComPorta : alvo.host;
  const hostOk = hostAlvo === hostP || hostAlvo.endsWith(`.${hostP}`);
  if (!hostOk) return false;
  return !caminhoP || alvo.caminho === caminhoP || alvo.caminho.startsWith(caminhoP.endsWith("/") ? caminhoP : `${caminhoP}/`);
}

/** localhost, 127.x.x.x, [::1], 0.0.0.0 (e o IPv4 mapeado em IPv6). Puro. */
export function hostDeLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(h) || h === "::1" || h === "0.0.0.0" || h === "::" || /^::ffff:127\./.test(h) || /^::ffff:7f/.test(h);
}

/** 10/8, 172.16/12, 192.168/16 e o link-local 169.254/16. Puro. */
export function hostDeRedePrivada(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/**
 * O endereço é um serviço da própria Órbita nesta máquina ou na rede de casa?
 * Loopback em qualquer porta da Órbita, e rede privada nas portas do
 * `dev:rede`. Puro.
 */
export function ehServicoDaOrbita(partes: { host: string; hostComPorta: string }, portas: readonly number[] = PORTAS_DA_ORBITA): boolean {
  const porta = Number(partes.hostComPorta.slice(partes.host.length + 1)) || 0;
  if (!porta) return false;
  if (hostDeLoopback(partes.host)) return portas.includes(porta);
  if (hostDeRedePrivada(partes.host)) return PORTAS_DA_REDE.includes(porta);
  return false;
}

/**
 * A URL cai numa categoria bloqueada? Devolve a categoria, ou null. URL que
 * nem dá para ler é tratada como bloqueada ("navegador"): falha fechada. Puro.
 */
export function categoriaBloqueada(url: string, c: ContextoDeBloqueio): Categoria | null {
  const ativas = new Set(c.categorias.map((x) => x.trim().toLowerCase()));
  if (url === "about:blank" || url === "") return null;
  const partes = partesDaUrl(url);
  if (!partes) return "navegador";
  if ((ESQUEMAS_DO_NAVEGADOR as readonly string[]).includes(partes.esquema) || (partes.esquema !== "http:" && partes.esquema !== "https:")) {
    // esquema que não é web nunca é lido, com ou sem a categoria marcada: não é página de terceiro, é o navegador ou o disco
    return "navegador";
  }
  // a Órbita é FIXA: vale com ou sem a categoria marcada (I-1)
  if (c.origensDaOrbita.some((o) => casaDominio(partes, o)) || ehServicoDaOrbita(partes, c.portasDaOrbita)) return "orbita";
  if (ativas.has("bancos") && c.bancos.some((b) => casaDominio(partes, b))) return "bancos";
  for (const cat of ["senhas", "webmail", "contas", "navegador"] as const) {
    if (ativas.has(cat) && DOMINIOS_DA_CATEGORIA[cat].some((d) => casaDominio(partes, d))) return cat;
  }
  return null;
}

/** As variáveis do ambiente que dizem onde a Órbita (ou um serviço dela) responde. */
const URLS_DA_ORBITA = ["BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL", "APP_URL", "API_URL", "NEXT_PUBLIC_API_URL", "ORBITA_URL", "ORBITA_PUBLIC_URL", "VOICE_URL", "PERCEPTION_URL", "MAOS_URL", "GOWA_URL"];

/** As origens da Órbita, das variáveis do ambiente mais as locais de sempre. Puro (recebe o ambiente). */
export function origensDaOrbita(env: Record<string, string | undefined>): string[] {
  const set = new Set<string>();
  for (const h of ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]) for (const p of PORTAS_DA_ORBITA) set.add(`${h}:${p}`);
  for (const k of URLS_DA_ORBITA) {
    const v = env[k];
    if (!v) continue;
    const p = partesDaUrl(v);
    if (p) set.add(p.hostComPorta);
  }
  return [...set];
}

/** As portas da Órbita: as de sempre e as que o ambiente diz (PORT, API_PORT e as das URLs). Puro. */
export function portasDaOrbita(env: Record<string, string | undefined>): number[] {
  const set = new Set<number>(PORTAS_DA_ORBITA);
  for (const k of ["PORT", "API_PORT", "WEB_PORT"]) {
    const n = Number(env[k]);
    if (Number.isInteger(n) && n > 0 && n < 65536) set.add(n);
  }
  for (const k of URLS_DA_ORBITA) {
    try {
      const u = new URL(env[k] ?? "");
      if (u.port) set.add(Number(u.port));
    } catch {
      /* variável vazia ou que não é URL */
    }
  }
  return [...set];
}

/**
 * A lista de padrões que a extensão recebe para recusar do lado dela, sem
 * precisar perguntar ao api a cada aba. Puro.
 */
export function padroesBloqueados(c: ContextoDeBloqueio): string[] {
  const ativas = new Set(c.categorias.map((x) => x.trim().toLowerCase()));
  const out: string[] = [];
  if (ativas.has("bancos")) out.push(...c.bancos);
  // fixa: a Órbita vai sempre
  out.push(...c.origensDaOrbita);
  for (const cat of ["senhas", "webmail", "contas", "navegador"] as const) if (ativas.has(cat)) out.push(...DOMINIOS_DA_CATEGORIA[cat]);
  return [...new Set(out.map((x) => x.trim().toLowerCase()).filter(Boolean))];
}

/**
 * A regra que as MÃOS aplicam sozinhas (a extensão e o perfil dedicado), com
 * a lista que o core mandou: esquema que não é web, padrão bloqueado, ou o
 * padrão "nada" sem o domínio na lista liberada. Puro.
 */
export function urlRecusadaPelasMaos(url: string, regra: { bloqueados: readonly string[]; liberados: readonly string[]; padraoBloqueado: boolean; portasDaOrbita?: readonly number[] }): boolean {
  if (url === "about:blank" || url === "") return false;
  const partes = partesDaUrl(url);
  if (!partes) return true;
  if (partes.esquema !== "http:" && partes.esquema !== "https:") return true;
  // a própria Órbita nesta máquina e na rede de casa, sem depender da lista que o api mandou
  if (ehServicoDaOrbita(partes, regra.portasDaOrbita)) return true;
  if (regra.bloqueados.some((b) => casaDominio(partes, b))) return true;
  if (regra.padraoBloqueado && !regra.liberados.some((l) => casaDominio(partes, l))) return true;
  return false;
}

/** O domínio da URL casa com algum da lista (com subdomínios). Puro. */
export function urlNaLista(url: string, lista: readonly string[]): boolean {
  const partes = partesDaUrl(url);
  return !!partes && lista.some((d) => casaDominio(partes, d));
}
