import { search as ddgSearch, SafeSearchType } from "duck-duck-scrape";
import { safeFetch, SsrfError } from "@/lib/net/ssrf";

export interface WebResult {
  titulo: string;
  url: string;
  trecho: string;
}

async function wikipediaSearch(query: string, max: number): Promise<WebResult[]> {
  const api =
    "https://pt.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=" +
    max +
    "&srsearch=" +
    encodeURIComponent(query);
  const r = await fetch(api, { headers: { "User-Agent": "OrbitaBot/1.0 (assistente pessoal)" } });
  const j = (await r.json()) as { query?: { search?: Array<{ title: string; snippet?: string }> } };
  const hits = j.query?.search ?? [];
  return hits.map((h) => ({
    titulo: h.title,
    url: "https://pt.wikipedia.org/wiki/" + encodeURIComponent(h.title.replace(/ /g, "_")),
    trecho: (h.snippet ?? "").replace(/<[^>]+>/g, ""),
  }));
}

/** Pesquisa na web: tenta DuckDuckGo, cai para Wikipedia se bloqueado. */
export async function searchWeb(query: string, max = 5): Promise<{ fonte: string; resultados: WebResult[] }> {
  try {
    const res = await ddgSearch(query, { safeSearch: SafeSearchType.MODERATE });
    const resultados = (res.results ?? []).slice(0, max).map((x) => ({
      titulo: x.title,
      url: x.url,
      trecho: (x.description ?? "").replace(/<[^>]+>/g, ""),
    }));
    if (resultados.length) return { fonte: "duckduckgo", resultados };
  } catch {
    // bloqueado / offline → fallback
  }
  return { fonte: "wikipedia", resultados: await wikipediaSearch(query, max) };
}

/**
 * Lê o conteúdo textual de uma página web. Usa safeFetch (defesa SSRF): a URL
 * é dirigida pelo LLM a partir de conteúdo não confiável (e-mails/páginas), então
 * bloqueamos loopback/rede interna/metadata da cloud e limitamos o tamanho lido.
 */
export async function fetchPage(url: string, maxChars = 3500): Promise<string> {
  let res: Response;
  try {
    res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; OrbitaBot/1.0)" } });
  } catch (e) {
    if (e instanceof SsrfError) return `Não posso acessar essa URL (${e.message}).`;
    throw e;
  }
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype && !/text|html|xml|json/i.test(ctype)) return `Conteúdo não textual (${ctype.split(";")[0]}).`;
  // limita a leitura para não puxar páginas gigantes
  const raw = await res.text();
  const html = raw.slice(0, 200_000);
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}
