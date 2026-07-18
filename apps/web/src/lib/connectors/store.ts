import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { connection } from "@/lib/db/connector-schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { getConnector, isConfigured, redirectUri, type ConnectorId } from "./registry";

/** Monta a URL de autorização (authorization code flow) com state anti-CSRF. */
export function buildAuthorizeUrl(id: ConnectorId, state: string): string {
  const def = getConnector(id);
  if (!def || !def.clientId) throw new Error(`Conector ${id} não configurado`);
  const p = new URLSearchParams({
    client_id: def.clientId,
    redirect_uri: redirectUri(id),
    response_type: "code",
    state,
    ...(def.scopes.length ? { scope: def.scopes.join(" ") } : {}),
    ...(def.authorizeParams ?? {}),
  });
  return `${def.authorizeUrl}?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  // Slack devolve o token de usuário aninhado + metadados de workspace.
  authed_user?: { access_token?: string; scope?: string };
  team?: { name?: string };
  workspace_name?: string;
  bot_id?: string;
}

async function postToken(url: string, body: URLSearchParams, headers: Record<string, string> = {}): Promise<TokenResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers },
    body,
  });
  const json = (await res.json()) as TokenResponse & { error?: string; ok?: boolean };
  if (!res.ok || json.error || json.ok === false) {
    throw new Error(`Falha ao obter token (${id(url)}): ${json.error ?? res.status}`);
  }
  return json;
}
function id(url: string) {
  return url.includes("google") ? "google" : url.includes("notion") ? "notion" : "slack";
}

/** Troca o `code` do callback por tokens e persiste (criptografado). */
export async function exchangeCodeAndSave(cid: ConnectorId, userId: string, code: string): Promise<void> {
  const def = getConnector(cid);
  if (!def || !def.clientId || !def.clientSecret) throw new Error(`Conector ${cid} não configurado`);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(cid),
    client_id: def.clientId,
    client_secret: def.clientSecret,
  });
  // Notion exige Basic auth + JSON; tratamos como form igual aos demais via header.
  const headers: Record<string, string> =
    cid === "notion"
      ? { Authorization: `Basic ${Buffer.from(`${def.clientId}:${def.clientSecret}`).toString("base64")}` }
      : {};

  const tok = await postToken(def.tokenUrl, body, headers);

  // Slack: o token do usuário vem em authed_user.access_token.
  const accessToken = cid === "slack" ? tok.authed_user?.access_token ?? tok.access_token : tok.access_token;
  const scope = cid === "slack" ? tok.authed_user?.scope ?? tok.scope : tok.scope;
  const accountLabel = tok.team?.name ?? tok.workspace_name ?? null;
  if (!accessToken) throw new Error("Resposta sem access_token");

  const expiresAt = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null;

  await db
    .insert(connection)
    .values({
      userId,
      provider: cid,
      accountLabel,
      accessTokenEnc: encryptSecret(accessToken),
      refreshTokenEnc: tok.refresh_token ? encryptSecret(tok.refresh_token) : null,
      scope: scope ?? null,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [connection.userId, connection.provider],
      set: {
        accessTokenEnc: encryptSecret(accessToken),
        // preserva refresh anterior se o provedor não reenviar um novo
        ...(tok.refresh_token ? { refreshTokenEnc: encryptSecret(tok.refresh_token) } : {}),
        accountLabel,
        scope: scope ?? null,
        expiresAt,
        updatedAt: new Date(),
      },
    });
}

/** Renova o access token via refresh_token (Google). Salva o novo e retorna-o. */
async function refresh(cid: ConnectorId, userId: string, refreshToken: string): Promise<string> {
  const def = getConnector(cid);
  if (!def?.clientId || !def.clientSecret) throw new Error(`Conector ${cid} não configurado`);
  const tok = await postToken(
    def.tokenUrl,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: def.clientId,
      client_secret: def.clientSecret,
    }),
  );
  const expiresAt = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null;
  await db
    .update(connection)
    .set({ accessTokenEnc: encryptSecret(tok.access_token), expiresAt, updatedAt: new Date() })
    .where(and(eq(connection.userId, userId), eq(connection.provider, cid)));
  return tok.access_token;
}

/**
 * Retorna um access token válido para o conector, renovando se expirado.
 * `null` se o usuário não conectou esse serviço.
 */
export async function getAccessToken(cid: ConnectorId, userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(connection)
    .where(and(eq(connection.userId, userId), eq(connection.provider, cid)))
    .limit(1);
  if (!row) return null;

  const expiringSoon = row.expiresAt ? row.expiresAt.getTime() - Date.now() < 60_000 : false;
  if (expiringSoon && row.refreshTokenEnc) {
    try {
      return await refresh(cid, userId, decryptSecret(row.refreshTokenEnc));
    } catch {
      // se o refresh falhar, tenta o token atual (pode ainda valer)
    }
  }
  return decryptSecret(row.accessTokenEnc);
}

/** Conjunto de conectores que o usuário conectou (para expor as tools certas). */
export async function connectedProviders(userId: string): Promise<Set<ConnectorId>> {
  const rows = await db
    .select({ provider: connection.provider })
    .from(connection)
    .where(eq(connection.userId, userId));
  return new Set(rows.map((r) => r.provider as ConnectorId));
}

/** Status por conector (configurado no ambiente + conectado pelo usuário). */
export async function connectorStatus(userId: string) {
  const connected = await connectedProviders(userId);
  const rows = await db
    .select({ provider: connection.provider, accountLabel: connection.accountLabel })
    .from(connection)
    .where(eq(connection.userId, userId));
  const labels = new Map(rows.map((r) => [r.provider, r.accountLabel]));
  return { connected, labels };
}

export async function disconnect(cid: ConnectorId, userId: string): Promise<void> {
  await db.delete(connection).where(and(eq(connection.userId, userId), eq(connection.provider, cid)));
}

export { isConfigured };
