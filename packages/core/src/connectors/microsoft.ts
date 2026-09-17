/** Cliente REST do Microsoft Graph (Teams). Recebe um access token válido. */

async function graph<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Microsoft Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TeamsTeam { id: string; name: string }
export interface TeamsChannel { id: string; name: string }
export interface TeamsChat { id: string; topic: string | null }

interface GraphList<T> { value: T[] }

export async function listJoinedTeams(token: string): Promise<TeamsTeam[]> {
  const r = await graph<GraphList<{ id: string; displayName: string }>>(token, "/me/joinedTeams");
  return r.value.map((t) => ({ id: t.id, name: t.displayName }));
}

export async function listChannels(token: string, teamId: string): Promise<TeamsChannel[]> {
  const r = await graph<GraphList<{ id: string; displayName: string }>>(token, `/teams/${encodeURIComponent(teamId)}/channels`);
  return r.value.map((c) => ({ id: c.id, name: c.displayName }));
}

/** Chats 1:1 e em grupo (não canais de equipe). */
export async function listChats(token: string): Promise<TeamsChat[]> {
  const r = await graph<GraphList<{ id: string; topic: string | null }>>(token, "/me/chats?$top=20");
  return r.value.map((c) => ({ id: c.id, topic: c.topic }));
}

/** Posta uma mensagem num canal de equipe. Chamar só após confirmação explícita. */
export async function postChannelMessage(token: string, teamId: string, channelId: string, text: string): Promise<{ id: string }> {
  const r = await graph<{ id: string }>(token, `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: { content: text } }),
  });
  return { id: r.id };
}

/** Posta uma mensagem num chat (1:1 ou grupo). Chamar só após confirmação explícita. */
export async function postChatMessage(token: string, chatId: string, text: string): Promise<{ id: string }> {
  const r = await graph<{ id: string }>(token, `/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: { content: text } }),
  });
  return { id: r.id };
}
