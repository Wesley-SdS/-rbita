import { search as ddgSearch, SafeSearchType } from "duck-duck-scrape";
import { safeFetch, SsrfError } from "../net/ssrf";
import { settings } from "../settings";
import { log } from "../observability/logger";

export interface WebResult {
  titulo: string;
  url: string;
  trecho: string;
}

/**
 * PESQUISA NA WEB, por uma cadeia de provedores (`web.provedores`, na ordem).
 *
 * Era "DuckDuckGo pela biblioteca, senão Wikipédia", e a biblioteca raspa uma
 * página que o DuckDuckGo bloqueia com frequência: a pesquisa caía na
 * Wikipédia e respondia "não achei" para qualquer coisa atual (medido em
 * 27/09/2026 com "o novo Opus 5.5"). Agora: APIs com chave quando existem
 * (Tavily, Brave), depois as páginas HTML simples do DuckDuckGo e do Bing, que
 * responderam nesta máquina, e a Wikipédia só no fim.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const semTags = (s: string) => decodificar(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** Código de caractere que não existe ("&#99999999;") fica como veio, em vez de derrubar a página inteira. */
function caractere(codigo: number, original: string): string {
  try {
    return String.fromCodePoint(codigo);
  } catch {
    return original;
  }
}

function decodificar(s: string): string {
  return (
    s
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      // entidade numérica ("&#92;" no título da Anthropic, "&#x2F;")
      .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => caractere(parseInt(h, 16), m))
      .replace(/&#(\d+);/g, (m, d: string) => caractere(Number(d), m))
      // &amp; POR ÚLTIMO: primeiro, "&amp;lt;" (texto literal "&lt;") viraria "<"
      .replace(/&amp;/g, "&")
  );
}

const decodificarUrl = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

async function tempoLimite(): Promise<number> {
  return (await settings.get("web.timeoutMs").catch(() => 8000)) ?? 8000;
}

async function comTempo(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(await tempoLimite()) });
}

/**
 * O Bing embrulha o link num rastreador ("bing.com/ck/a?…&u=a1<base64>"): o
 * modelo recebia o rastreador, e `ler_pagina` lia a página de redirecionamento
 * em vez do artigo. PURA.
 */
export function linkDoBing(href: string): string {
  if (!/bing\.com\/ck\/a/.test(href)) return href;
  const u = /[?&]u=a1([^&]+)/.exec(href)?.[1];
  if (!u) return href;
  try {
    const url = Buffer.from(u.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return /^https?:\/\//.test(url) ? url : href;
  } catch {
    return href;
  }
}

/** Página HTML do DuckDuckGo → resultados. PURA. Os links vêm pelo redirecionador `uddg`. */
export function lerDuckDuckGoHtml(html: string, max: number): WebResult[] {
  const out: WebResult[] = [];
  const blocos = html.split(/class="result__body"|class="result results_links/).slice(1);
  for (const b of blocos) {
    const link = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!link) continue;
    let url = decodificar(link[1]);
    const alvo = /[?&]uddg=([^&]+)/.exec(url);
    if (alvo) url = decodificarUrl(alvo[1]);
    if (url.startsWith("//")) url = "https:" + url;
    if (url.includes("duckduckgo.com/y.js")) continue; // anúncio
    const trecho = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    out.push({ titulo: semTags(link[2]), url, trecho: trecho ? semTags(trecho[1]) : "" });
    if (out.length >= max) break;
  }
  return out;
}

/** Página de resultados do Bing → resultados. PURA. */
export function lerBingHtml(html: string, max: number): WebResult[] {
  const out: WebResult[] = [];
  for (const b of html.split('<li class="b_algo"').slice(1)) {
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!link) continue;
    // `<p` sozinho casava `<path` do SVG e o trecho vinha com a miga de pão
    const trecho = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/.exec(b);
    out.push({ titulo: semTags(link[2]), url: linkDoBing(decodificar(link[1])), trecho: trecho ? semTags(trecho[1]) : "" });
    if (out.length >= max) break;
  }
  return out;
}

type Provedor = (q: string, max: number) => Promise<WebResult[]>;

const PROVEDORES: Record<string, Provedor> = {
  tavily: async (q, max) => {
    const key = process.env.TAVILY_API_KEY;
    if (!key) return [];
    const r = await comTempo("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: key, query: q, max_results: max }) });
    const j = (await r.json()) as { results?: { title: string; url: string; content?: string }[] };
    return (j.results ?? []).map((x) => ({ titulo: x.title, url: x.url, trecho: (x.content ?? "").slice(0, 400) }));
  },
  brave: async (q, max) => {
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key) return [];
    const r = await comTempo(`https://api.search.brave.com/res/v1/web/search?count=${max}&q=${encodeURIComponent(q)}`, { headers: { "X-Subscription-Token": key, Accept: "application/json" } });
    const j = (await r.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
    return (j.web?.results ?? []).map((x) => ({ titulo: semTags(x.title), url: x.url, trecho: semTags(x.description ?? "") }));
  },
  duckduckgo: async (q, max) => {
    const r = await comTempo("https://html.duckduckgo.com/html/?kl=br-pt&q=" + encodeURIComponent(q), { headers: { "User-Agent": UA } });
    const html = await r.text();
    const lidos = lerDuckDuckGoHtml(html, max);
    if (lidos.length) return lidos;
    // a página HTML falhou: a biblioteca usa outra rota do DuckDuckGo. Com
    // prazo: ela não tem timeout próprio e pendurava o turno
    const ms = await tempoLimite();
    const res = await Promise.race([
      ddgSearch(q, { safeSearch: SafeSearchType.MODERATE }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("duckduckgo demorou")), ms).unref?.()),
    ]);
    return (res.results ?? []).slice(0, max).map((x) => ({ titulo: x.title, url: x.url, trecho: semTags(x.description ?? "") }));
  },
  bing: async (q, max) => {
    const r = await comTempo(`https://www.bing.com/search?setlang=pt-br&cc=br&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" } });
    return lerBingHtml(await r.text(), max);
  },
  wikipedia: async (q, max) => {
    const api = `https://pt.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${max}&srsearch=${encodeURIComponent(q)}`;
    const r = await comTempo(api, { headers: { "User-Agent": "OrbitaBot/1.0 (assistente pessoal)" } });
    const j = (await r.json()) as { query?: { search?: Array<{ title: string; snippet?: string }> } };
    return (j.query?.search ?? []).map((h) => ({
      titulo: h.title,
      url: "https://pt.wikipedia.org/wiki/" + encodeURIComponent(h.title.replace(/ /g, "_")),
      trecho: semTags(h.snippet ?? ""),
    }));
  },
};

/** Pesquisa na web pela cadeia de provedores; o primeiro que trouxer resultado responde. */
const ORDEM_PADRAO = ["tavily", "brave", "duckduckgo", "bing", "wikipedia"];

export async function searchWeb(query: string, max = 5): Promise<{ fonte: string; resultados: WebResult[] }> {
  const escolhidos = await settings.get("web.provedores").catch(() => ORDEM_PADRAO);
  // Nome errado ("duckduck") era pulado em silêncio, e lista vazia desligava a
  // pesquisa sem aviso. Agora o desconhecido vai para o log e, sem nenhum
  // válido, vale a ordem padrão.
  const desconhecidos = escolhidos.filter((n) => !Object.hasOwn(PROVEDORES, n));
  if (desconhecidos.length) log.warn("web.provedor_desconhecido", { nomes: desconhecidos.slice(0, 5) });
  const validos = escolhidos.filter((n) => Object.hasOwn(PROVEDORES, n));
  for (const nome of validos.length ? validos : ORDEM_PADRAO) {
    const p = PROVEDORES[nome];
    try {
      const resultados = (await p(query, max)).filter((r) => r.url && r.titulo);
      if (resultados.length) return { fonte: nome, resultados };
    } catch (e) {
      log.info("web.provedor_falhou", { provedor: nome, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return { fonte: "nenhuma", resultados: [] };
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
