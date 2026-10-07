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

export interface MensagemDoSlack {
  eventoId: string;
  tipo: "mencao" | "mensagem_direta";
  canal: string;
  autor: string;
  texto: string;
  url: string | null;
  quando: Date;
}

interface Achado {
  ts: string;
  text?: string;
  username?: string;
  user?: string;
  permalink?: string;
  channel?: { id?: string; name?: string; is_im?: boolean };
}

const eusEmCache = new Map<string, string>();

/** O id do dono no workspace: é ele que vai na busca por menção (`<@U…>`). */
export async function meuIdNoSlack(token: string, chave: string): Promise<string> {
  const c = eusEmCache.get(chave);
  if (c) return c;
  const r = await sapi<{ user_id: string }>(token, "auth.test", { method: "GET" });
  eusEmCache.set(chave, r.user_id);
  return r.user_id;
}

/**
 * O que chegou para o dono: menções (`<@U…>`) e mensagens diretas (`to:me`),
 * pela busca do Slack, que exige token de USUÁRIO com `search:read`. Ler as
 * conversas uma a uma estouraria o limite de chamadas com poucas dezenas de
 * conversas abertas; a busca resolve as duas coisas em duas chamadas.
 */
export async function oQueChegouNoSlack(token: string, chave: string, desde: Date, max = 20): Promise<MensagemDoSlack[]> {
  const eu = await meuIdNoSlack(token, chave);
  const dia = desde.toISOString().slice(0, 10);
  const buscar = async (q: string, tipo: MensagemDoSlack["tipo"]) => {
    const r = await sapi<{ messages?: { matches?: Achado[] } }>(token, `search.messages?query=${encodeURIComponent(`${q} after:${dia}`)}&sort=timestamp&sort_dir=desc&count=${max}`, { method: "GET" });
    return (r.messages?.matches ?? [])
      .filter((m) => m.user !== eu && Number(m.ts) * 1000 >= desde.getTime())
      .map((m): MensagemDoSlack => ({
        eventoId: `${tipo}:${m.channel?.id ?? "?"}:${m.ts}`,
        tipo,
        canal: m.channel?.is_im ? "mensagem direta" : `#${m.channel?.name ?? "canal"}`,
        autor: m.username ?? m.user ?? "",
        texto: (m.text ?? "").replace(/<@[A-Z0-9]+(\|[^>]+)?>/g, "@você").trim(),
        url: m.permalink ?? null,
        quando: new Date(Number(m.ts) * 1000),
      }));
  };
  const [mencoes, diretas] = await Promise.all([buscar(`<@${eu}>`, "mencao"), buscar("to:me", "mensagem_direta")]);
  // a mesma mensagem pode vir nas duas buscas (menção dentro de uma conversa direta)
  const vistas = new Set<string>();
  return [...diretas, ...mencoes].filter((m) => {
    const k = m.eventoId.split(":").slice(1).join(":");
    return vistas.has(k) ? false : (vistas.add(k), true);
  });
}
