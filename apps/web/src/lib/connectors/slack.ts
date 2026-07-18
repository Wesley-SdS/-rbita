/** Client REST do Slack (listar canais + postar mensagem). Recebe o access token. */

async function sapi<T>(token: string, method: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8", ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as T & { ok: boolean; error?: string };
  if (!json.ok) throw new Error(`Slack API ${method}: ${json.error ?? "erro"}`);
  return json;
}

interface ChannelsResp { channels?: { id: string; name: string }[] }
export interface SlackChannel { id: string; name: string }

export async function listChannels(token: string, max = 50): Promise<SlackChannel[]> {
  const data = await sapi<ChannelsResp>(
    token,
    `conversations.list?limit=${max}&exclude_archived=true&types=public_channel`,
    { method: "GET" },
  );
  return (data.channels ?? []).map((c) => ({ id: c.id, name: c.name }));
}

/** Posta uma mensagem. Chamar só após confirmação explícita do usuário. */
export async function postMessage(token: string, channel: string, text: string): Promise<{ ts: string }> {
  return sapi<{ ts: string }>(token, "chat.postMessage", {
    method: "POST",
    body: JSON.stringify({ channel, text }),
  });
}
