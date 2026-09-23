import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { connection, type Connection } from "@orbita/db/connector-schema";
import { encryptSecret, decryptSecret } from "../crypto";
import { identidadeDaConta, type RespostaDeToken } from "./identidade";
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

interface TokenResponse extends RespostaDeToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function postToken(
  providerId: string,
  url: string,
  body: URLSearchParams,
  headers: Record<string, string> = {},
  comoJson = false,
): Promise<TokenResponse> {
  // o Atlassian recusa form-urlencoded com um 400 que não explica nada
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": comoJson ? "application/json" : "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...headers,
    },
    body: comoJson ? JSON.stringify(Object.fromEntries(body)) : body,
  });
  const json = (await res.json()) as TokenResponse & { error?: string; ok?: boolean };
  if (!res.ok || json.error || json.ok === false) {
    throw new Error(`Falha ao obter token (${providerId}): ${json.error ?? res.status}`);
  }
  return json;
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

  const tok = await postToken(cid, def.tokenUrl, body, headers, def.tokenAsJson);

  // Slack: o token do usuário vem em authed_user.access_token.
  const accessToken = cid === "slack" ? tok.authed_user?.access_token ?? tok.access_token : tok.access_token;
  const scope = cid === "slack" ? tok.authed_user?.scope ?? tok.scope : tok.scope;
  if (!accessToken) throw new Error("Resposta sem access_token");

  // QUAL conta é esta. Sem isto, conectar a segunda conta do Google
  // substituiria a primeira em silêncio (a chave única era usuário+provedor).
  let { externalId, label } = identidadeDaConta(cid, tok);
  // provedor que não diz quem é no retorno do token (Atlassian) precisa de uma
  // segunda chamada. Falhar aqui degrada para conta única em vez de perder a
  // conexão inteira.
  if (!externalId && def.descobrirConta) {
    try {
      const achado = await def.descobrirConta(accessToken);
      externalId = achado.externalId;
      label = label ?? achado.label;
    } catch {
      /* segue como conta única */
    }
  }
  const expiresAt = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null;

  // A primeira conta de um provedor nasce principal. É ela que responde quando
  // o pedido não diz qual conta usar ("manda um e-mail pro João").
  const jaTem = await db
    .select({ id: connection.id })
    .from(connection)
    .where(and(eq(connection.userId, userId), eq(connection.provider, cid)))
    .limit(1);

  await db
    .insert(connection)
    .values({
      userId,
      provider: cid,
      externalId,
      accountLabel: label,
      principal: jaTem.length === 0,
      accessTokenEnc: encryptSecret(accessToken),
      refreshTokenEnc: tok.refresh_token ? encryptSecret(tok.refresh_token) : null,
      scope: scope ?? null,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [connection.userId, connection.provider, connection.externalId],
      set: {
        accessTokenEnc: encryptSecret(accessToken),
        // preserva refresh anterior se o provedor não reenviar um novo
        ...(tok.refresh_token ? { refreshTokenEnc: encryptSecret(tok.refresh_token) } : {}),
        // e preserva o rótulo antigo se este retorno não trouxer um
        ...(label ? { accountLabel: label } : {}),
        scope: scope ?? null,
        expiresAt,
        // reconectar pela tela zera o histórico de falha de renovação (RV.4)
        refreshFailures: 0,
        refreshFailedAt: null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Renova o access token via refresh_token. Salva o novo e devolve.
 *
 * `connectionId` não é opcional por preguiça de assinatura: o UPDATE era por
 * (usuário, provedor), e com duas contas do mesmo provedor isso gravaria o
 * token da conta A em cima da conta B. As duas continuariam "conectadas" na
 * tela, e uma delas passaria a ler a caixa de entrada da outra.
 */
export async function refreshConnectionToken(cid: ConnectorId, userId: string, refreshToken: string, connectionId: string): Promise<string> {
  const def = getConnector(cid);
  if (!def?.clientId || !def.clientSecret) throw new Error(`Conector ${cid} não configurado`);
  const tok = await postToken(
    cid,
    def.tokenUrl,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: def.clientId,
      client_secret: def.clientSecret,
    }),
    {},
    def.tokenAsJson,
  );
  const expiresAt = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null;
  await db
    .update(connection)
    // qualquer renovação bem-sucedida (laço ou request) zera o histórico de falha:
    // senão uma falha passageira antiga silenciava o aviso de uma revogação real (RV.4)
    .set({ accessTokenEnc: encryptSecret(tok.access_token), expiresAt, refreshFailures: 0, refreshFailedAt: null, updatedAt: new Date() })
    .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
  return tok.access_token;
}

/**
 * As contas que o dono conectou num provedor. A principal vem primeiro.
 *
 * `principal desc` e depois a mais antiga: a ordem tem de ser estável entre
 * chamadas, senão "a primeira conta" muda de significado entre um pedido e o
 * seguinte.
 */
export async function listarContas(userId: string, cid?: ConnectorId): Promise<Connection[]> {
  const filtro = cid ? and(eq(connection.userId, userId), eq(connection.provider, cid)) : eq(connection.userId, userId);
  return db.select().from(connection).where(filtro).orderBy(desc(connection.principal), asc(connection.createdAt));
}

/** Token válido de UMA conexão, renovando se estiver perto de expirar. */
export async function tokenDaConexao(row: Connection): Promise<string> {
  const expiringSoon = row.expiresAt ? row.expiresAt.getTime() - Date.now() < 60_000 : false;
  if (expiringSoon && row.refreshTokenEnc) {
    try {
      return await refreshConnectionToken(row.provider as ConnectorId, row.userId, decryptSecret(row.refreshTokenEnc), row.id);
    } catch {
      // se o refresh falhar, tenta o token atual (pode ainda valer)
    }
  }
  return decryptSecret(row.accessTokenEnc);
}

/**
 * Token da conta que responde quando o pedido não diz qual.
 *
 * `connectionId` escolhe uma conta específica (o que a tool usa quando o dono
 * diz "pela conta do trabalho"). Sem ele, vale a principal. `null` quando o
 * usuário não conectou esse serviço.
 */
export async function getAccessToken(cid: ConnectorId, userId: string, connectionId?: string): Promise<string | null> {
  const contas = await listarContas(userId, cid);
  const row = connectionId ? contas.find((c) => c.id === connectionId) : contas[0];
  if (!row) return null;
  return tokenDaConexao(row);
}

/**
 * Um token por conta conectada, para LEITURA que varre tudo.
 *
 * É a diferença que faz a multi-conta valer a pena: "tenho algum e-mail
 * importante?" tem de olhar as duas caixas, não só a principal. Escrita
 * continua sendo de uma conta só, porque mandar o e-mail pela conta errada é
 * pior do que perguntar.
 */
export async function tokensDeTodasAsContas(cid: ConnectorId, userId: string): Promise<{ conexao: Connection; token: string }[]> {
  const contas = await listarContas(userId, cid);
  const out: { conexao: Connection; token: string }[] = [];
  for (const conexao of contas) {
    try {
      out.push({ conexao, token: await tokenDaConexao(conexao) });
    } catch {
      // uma conta com token podre não pode esconder as outras
    }
  }
  return out;
}

/** Troca qual conta é a principal daquele provedor. */
export async function definirContaPrincipal(userId: string, connectionId: string): Promise<boolean> {
  const [alvo] = await db
    .select()
    .from(connection)
    .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)))
    .limit(1);
  if (!alvo) return false;
  // tira de todas antes de pôr numa: duas principais no mesmo provedor fariam
  // a escrita depender da ordem do banco
  await db
    .update(connection)
    .set({ principal: false, updatedAt: new Date() })
    .where(and(eq(connection.userId, userId), eq(connection.provider, alvo.provider)));
  await db.update(connection).set({ principal: true, updatedAt: new Date() }).where(eq(connection.id, connectionId));
  return true;
}

/** IDs de todos os usuários que conectaram este provedor (para laços do processo persistente). */
export async function usersConnected(cid: ConnectorId): Promise<string[]> {
  const rows = await db.select({ userId: connection.userId }).from(connection).where(eq(connection.provider, cid));
  return rows.map((r) => r.userId);
}

/** Conjunto de conectores que o usuário conectou (para expor as tools certas). */
export async function connectedProviders(userId: string): Promise<Set<ConnectorId>> {
  const rows = await db
    .select({ provider: connection.provider })
    .from(connection)
    .where(eq(connection.userId, userId));
  return new Set(rows.map((r) => r.provider as ConnectorId));
}

/** Status por conector (configurado no ambiente + contas conectadas pelo usuário). */
export async function connectorStatus(userId: string) {
  const rows = await listarContas(userId);
  const connected = new Set(rows.map((r) => r.provider as ConnectorId));
  // uma linha por CONTA, não por provedor: é o que a tela precisa para mostrar
  // "Google: pessoal (principal) e trabalho"
  const contas = rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    label: r.accountLabel,
    principal: r.principal,
    expiraEm: r.expiresAt?.toISOString() ?? null,
    falhasDeRenovacao: r.refreshFailures,
  }));
  // mantido para quem só quer o rótulo de uma conta (telas antigas)
  const labels = new Map(rows.filter((r) => r.principal).map((r) => [r.provider, r.accountLabel]));
  return { connected, labels, contas };
}

/**
 * Desconecta UMA conta, pelo id.
 *
 * Era por provedor, e isso agora apagaria as duas contas do Google de uma vez.
 * Se a conta apagada era a principal, a mais antiga das restantes assume:
 * deixar o provedor conectado sem principal faria toda escrita falhar.
 */
export async function desconectarConta(userId: string, connectionId: string): Promise<boolean> {
  const [alvo] = await db
    .select()
    .from(connection)
    .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)))
    .limit(1);
  if (!alvo) return false;

  await db.delete(connection).where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));

  if (alvo.principal) {
    const restantes = await listarContas(userId, alvo.provider as ConnectorId);
    if (restantes[0]) await definirContaPrincipal(userId, restantes[0].id);
  }
  return true;
}

/** Desconecta TODAS as contas de um provedor (o "desconectar o Google inteiro"). */
export async function disconnect(cid: ConnectorId, userId: string): Promise<void> {
  await db.delete(connection).where(and(eq(connection.userId, userId), eq(connection.provider, cid)));
}

export { isConfigured };
