import { createHash } from "node:crypto";
import type { ConnectorId } from "./registry";

/**
 * Conectar COLANDO UM TOKEN, sem aplicativo OAuth.
 *
 * Decisão do dono (06/10/2026): GitHub, Jira e Slack entram por token, porque
 * criar um aplicativo OAuth em cada serviço para uma pessoa só é burocracia
 * que não protege nada a mais. O token é conferido no serviço ANTES de ser
 * guardado (um token errado não vira uma conexão que falha calada depois),
 * e vai cifrado para a mesma tabela das conexões OAuth: várias contas,
 * apagar junto com a conta e a mesma tela de Conexões valem igual.
 */

export interface CampoDeToken {
  nome: string;
  rotulo: string;
  tipo: "text" | "password" | "url" | "email";
  exemplo?: string;
}

export interface ContaPorToken {
  externalId: string;
  label: string;
  /** o que vai cifrado no lugar do access token */
  segredo: string;
}

export class TokenRecusado extends Error {}

const curto = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);

/**
 * O Jira por token não tem `cloudid`: fala com o site direto, com o e-mail e
 * o token de API em Basic. O segredo guarda os três, e o cliente do Jira
 * reconhece este formato (`connectors/jira.ts`).
 */
export interface AcessoBasicoDoJira {
  modo: "basico";
  site: string;
  email: string;
  token: string;
}

export function lerAcessoBasico(segredo: string): AcessoBasicoDoJira | null {
  if (!segredo.startsWith("{")) return null;
  try {
    const o = JSON.parse(segredo) as Partial<AcessoBasicoDoJira>;
    return o.modo === "basico" && o.site && o.email && o.token ? (o as AcessoBasicoDoJira) : null;
  } catch {
    return null;
  }
}

/** "suaempresa.atlassian.net", "https://suaempresa.atlassian.net/jira" → "https://suaempresa.atlassian.net". */
export function siteDoJira(entrada: string): string | null {
  const s = entrada.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return `https://${u.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

async function json<T>(res: Response, servico: string): Promise<T> {
  if (res.status === 401 || res.status === 403) throw new TokenRecusado(`O ${servico} recusou o token. Confira se ele foi copiado inteiro e se ainda vale.`);
  if (!res.ok) throw new TokenRecusado(`O ${servico} respondeu ${res.status}. Tente de novo em instantes.`);
  return (await res.json()) as T;
}

const comPrazo = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

export async function validarToken(cid: ConnectorId, valores: Record<string, string>): Promise<ContaPorToken> {
  if (cid === "github") {
    const token = valores.token?.trim() ?? "";
    if (token.length < 20) throw new TokenRecusado("Cole o token inteiro do GitHub.");
    const eu = await json<{ id?: number; login?: string }>(
      await comPrazo("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "orbita" } }),
      "GitHub",
    );
    if (!eu.id || !eu.login) throw new TokenRecusado("O GitHub não disse de quem é o token.");
    // dois tokens da MESMA pessoa (um por organização, como pede o token
    // fine-grained) são duas conexões: o id do usuário sozinho faria o
    // segundo substituir o primeiro
    return { externalId: `${eu.id}:${curto(token)}`, label: eu.login, segredo: token };
  }

  if (cid === "jira") {
    const site = siteDoJira(valores.site ?? "");
    const email = valores.email?.trim() ?? "";
    const token = valores.token?.trim() ?? "";
    if (!site) throw new TokenRecusado("Informe o endereço do Jira, como suaempresa.atlassian.net.");
    if (!email.includes("@") || token.length < 10) throw new TokenRecusado("Informe o e-mail da conta Atlassian e o token de API.");
    const basico = Buffer.from(`${email}:${token}`).toString("base64");
    const eu = await json<{ accountId?: string; displayName?: string }>(
      await comPrazo(`${site}/rest/api/3/myself`, { headers: { Authorization: `Basic ${basico}`, Accept: "application/json" } }),
      "Jira",
    );
    if (!eu.accountId) throw new TokenRecusado("O Jira não disse de quem é o token.");
    const segredo: AcessoBasicoDoJira = { modo: "basico", site, email, token };
    return { externalId: new URL(site).hostname, label: new URL(site).hostname.replace(/\.atlassian\.net$/, ""), segredo: JSON.stringify(segredo) };
  }

  if (cid === "slack") {
    const token = valores.token?.trim() ?? "";
    if (!token.startsWith("xoxp-")) throw new TokenRecusado("Use o token de USUÁRIO do Slack (começa com xoxp-), não o do bot.");
    const r = await json<{ ok: boolean; error?: string; team_id?: string; team?: string; user_id?: string }>(
      await comPrazo("https://slack.com/api/auth.test", { headers: { Authorization: `Bearer ${token}` } }),
      "Slack",
    );
    if (!r.ok || !r.team_id) throw new TokenRecusado(`O Slack recusou o token (${r.error ?? "sem motivo"}).`);
    // o mesmo id da conexão por OAuth (`team.id`): reconectar por token atualiza em vez de duplicar
    return { externalId: r.team_id, label: r.team ?? "Slack", segredo: token };
  }

  throw new TokenRecusado("Este serviço não conecta por token.");
}
