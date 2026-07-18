/** Client REST do Notion (search + leitura de página). Recebe o access token. */

const NOTION_VERSION = "2022-06-28";

async function napi<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Notion API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface SearchResp {
  results?: {
    id: string;
    url?: string;
    properties?: Record<string, { title?: { plain_text: string }[] }>;
    child_page?: { title?: string };
  }[];
}
export interface NotionHit { id: string; title: string; url: string }

export async function searchNotion(token: string, query: string, max = 5): Promise<NotionHit[]> {
  const data = await napi<SearchResp>(token, "/search", {
    method: "POST",
    body: JSON.stringify({ query, page_size: max, filter: { property: "object", value: "page" } }),
  });
  return (data.results ?? []).map((r) => {
    const titleProp = r.properties ? Object.values(r.properties).find((p) => p.title) : undefined;
    const title = titleProp?.title?.map((t) => t.plain_text).join("") || r.child_page?.title || "(sem título)";
    return { id: r.id, title, url: r.url ?? "" };
  });
}

interface BlocksResp {
  results?: { type: string; [k: string]: unknown }[];
}
/** Extrai o texto plano dos blocos de uma página (parágrafos, títulos, listas). */
export async function readNotionPage(token: string, pageId: string): Promise<string> {
  const data = await napi<BlocksResp>(token, `/blocks/${pageId}/children?page_size=100`);
  const lines: string[] = [];
  for (const b of data.results ?? []) {
    const rich = (b as Record<string, { rich_text?: { plain_text: string }[] }>)[b.type];
    const text = rich?.rich_text?.map((t) => t.plain_text).join("") ?? "";
    if (text) lines.push(text);
  }
  return lines.join("\n");
}
