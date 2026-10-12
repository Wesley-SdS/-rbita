import type { TipoDeAlvo } from "./dominios";

/**
 * O ENVELOPE de uma sessão de controle, em regras puras (PRD §5.4, F2): quais
 * apps e sites ele cobre, se ainda vale, e a frase que diz por que não.
 *
 * Lista vazia não é "qualquer um": envelope sem app não libera app nenhum. É
 * a falha fechada de sempre, e é por isso que o `controle_iniciar` exige pelo
 * menos um app (computador) ou um site (navegador).
 */

export type AlvoDaSessao = "computador" | "navegador" | "ambos";

/** "Code.exe", "VS Code" e "code" viram "code" e "vs code": a comparação ignora caixa, acento e `.exe`. */
export function normalizarApp(app: string): string {
  return app
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.exe$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Sufixos onde cada subdomínio é de um dono diferente (o padrão da chave
 * `navegador.sufixosPublicos`). "com.br" ou "github.io" num envelope liberaria
 * milhares de sites de gente diferente: o subdomínio vale ("meu-time.atlassian.net"),
 * o sufixo sozinho não.
 */
export const SUFIXOS_PUBLICOS: readonly string[] = [
  "com", "net", "org", "br", "com.br", "net.br", "org.br", "gov.br", "edu.br", "co", "io", "app", "dev", "co.uk", "com.au", "github.io", "githubusercontent.com", "gitlab.io",
  "atlassian.net", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "herokuapp.com", "web.app", "firebaseapp.com", "azurewebsites.net", "cloudfront.net",
  "blogspot.com", "wordpress.com", "s3.amazonaws.com", "appspot.com", "onrender.com", "fly.dev", "ngrok.io", "ngrok-free.app", "glitch.me", "repl.co",
];

/**
 * "https://www.jira.com/x?y" vira "jira.com"; "*.atlassian.net" fica
 * "atlassian.net" (subdomínio já vale). O que não é domínio vira "", e um
 * sufixo público sozinho ("com.br", "github.io") também: ele não é UM site.
 */
export function normalizarSite(site: string, sufixosPublicos: readonly string[] = SUFIXOS_PUBLICOS): string {
  let s = site.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^\*\./, "");
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = new URL(s).hostname;
  } catch {
    return "";
  }
  s = s.split(/[/?#:]/)[0]!.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return "";
  // `listaLimpa(itens, normalizarSite)` chama pelo `map`, que passa o ÍNDICE como 2º argumento: só lista vale
  const sufixos = Array.isArray(sufixosPublicos) ? sufixosPublicos : SUFIXOS_PUBLICOS;
  if (sufixos.some((x) => typeof x === "string" && x.trim().toLowerCase().replace(/^\*?\./, "") === s)) return "";
  return s.slice(0, 253);
}

/** Sem repetição e sem vazio, na ordem em que vieram. */
export function listaLimpa(itens: readonly string[], normalizar: (s: string) => string): string[] {
  return [...new Set(itens.map(normalizar).filter(Boolean))];
}

export function appNoEnvelope(app: string, apps: readonly string[]): boolean {
  const a = normalizarApp(app);
  return !!a && apps.some((x) => normalizarApp(x) === a);
}

/** O domínio ou um subdomínio dele: "app.jira.com" cabe em "jira.com"; "jira.com.evil.io" não. */
export function siteNoEnvelope(site: string, sites: readonly string[]): boolean {
  const d = normalizarSite(site);
  if (!d) return false;
  return sites.some((x) => {
    const s = normalizarSite(x);
    return !!s && (d === s || d.endsWith(`.${s}`));
  });
}

export function sessaoCobreTipo(alvo: AlvoDaSessao, tipo: TipoDeAlvo): boolean {
  return alvo === "ambos" || alvo === tipo;
}

export interface SessaoParaConferir {
  alvo: AlvoDaSessao;
  apps: readonly string[];
  sites: readonly string[];
  status: string;
  expiraEm: Date;
  passosUsados: number;
  tetoPassos: number;
}

/** O que a ação quer tocar. Sem `app`/`dominio`, a conferência é só de sessão (tipo, tempo e passos). */
export interface AlvoDaAcao {
  tipo: TipoDeAlvo;
  app?: string | null;
  dominio?: string | null;
}

export type Conferencia = { ok: true } | { ok: false; motivo: string; pausar?: "tempo" | "teto de passos" };

const COMO_ABRIR = 'Peça para abrir uma sessão de controle (a ferramenta controle_iniciar propõe o envelope, e o dono aprova).';

/**
 * A sessão deixa esta ação acontecer? Mensagem de recusa pronta para o modelo
 * repassar, sempre dizendo como seguir. Puro.
 */
export function conferirSessao(s: SessaoParaConferir | null, alvo: AlvoDaAcao, agora = new Date()): Conferencia {
  const onde = alvo.tipo === "computador" ? "no computador" : "no navegador";
  if (!s) return { ok: false, motivo: `Não há sessão de controle ativa ${onde}. ${COMO_ABRIR}` };
  if (s.status !== "ativa") return { ok: false, motivo: `A sessão de controle está ${s.status}. ${COMO_ABRIR}` };
  if (!sessaoCobreTipo(s.alvo, alvo.tipo)) return { ok: false, motivo: `A sessão aberta não cobre agir ${onde}. ${COMO_ABRIR}` };
  if (s.expiraEm.getTime() <= agora.getTime()) return { ok: false, motivo: `O tempo da sessão acabou. ${COMO_ABRIR}`, pausar: "tempo" };
  if (s.passosUsados >= s.tetoPassos) return { ok: false, motivo: `A sessão chegou ao teto de ${s.tetoPassos} passos. ${COMO_ABRIR}`, pausar: "teto de passos" };
  if (alvo.app && !appNoEnvelope(alvo.app, s.apps)) {
    return { ok: false, motivo: `O app "${alvo.app}" não está no envelope aprovado (${s.apps.join(", ") || "nenhum app"}). Para usá-lo, proponha um envelope novo.` };
  }
  if (alvo.dominio && !siteNoEnvelope(alvo.dominio, s.sites)) {
    return { ok: false, motivo: `O site "${normalizarSite(alvo.dominio) || alvo.dominio}" não está no envelope aprovado (${s.sites.join(", ") || "nenhum site"}). Para usá-lo, proponha um envelope novo.` };
  }
  return { ok: true };
}
