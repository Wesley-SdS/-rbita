import { decodificarEntidades } from "../texto/entidades";
import type { ResultadoDaBusca } from "./selecao";

/**
 * Lê o RSS de notícias do Bing e do Google. PURO.
 *
 * A busca web comum, perguntada por "inteligência artificial notícias",
 * devolveu nove páginas de seção e uma matéria (06/10/2026): buscador geral
 * acha o ÍNDICE do tema, não o que saiu hoje. O RSS dos agregadores de
 * notícia só tem matéria, com data e nome do veículo.
 *
 * O Bing embrulha o link num rastreador com o endereço real no parâmetro
 * `url=`; ele é tirado daí, senão a mesma matéria teria um link novo a cada
 * busca e voltaria todo dia como inédita. O Google não expõe o endereço real
 * (o link é um redirecionamento dele), por isso entra depois do Bing.
 */

export type FonteRss = "bing" | "google";

const semTags = (s: string) => decodificarEntidades(decodificarEntidades(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function campo(item: string, nome: string): string {
  const m = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, "i").exec(item);
  if (!m) return "";
  return m[1]!.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1").trim();
}

/** O endereço real dentro do rastreador do Bing Notícias. */
export function linkDoBingNoticias(href: string): string {
  try {
    const u = new URL(href);
    if (!/bing\.com$/.test(u.hostname) || !u.pathname.includes("apiclick")) return href;
    const real = u.searchParams.get("url");
    return real && /^https?:\/\//.test(real) ? real : href;
  } catch {
    return href;
  }
}

export function lerRss(xml: string, fonte: FonteRss): ResultadoDaBusca[] {
  const itens = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  return itens
    .map((item) => {
      const veiculo = semTags(fonte === "bing" ? campo(item, "News:Source") : campo(item, "source"));
      let titulo = semTags(campo(item, "title"));
      // o Google repete o veículo no fim da manchete ("... - CNN Brasil")
      if (veiculo && titulo.endsWith(` - ${veiculo}`)) titulo = titulo.slice(0, -(veiculo.length + 3)).trim();
      const link = decodificarEntidades(campo(item, "link"));
      const quando = Date.parse(campo(item, "pubDate"));
      return {
        titulo,
        url: fonte === "bing" ? linkDoBingNoticias(link) : link,
        // a descrição do Google é só a manchete de novo, com link: não é trecho
        trecho: fonte === "bing" ? semTags(campo(item, "description")) : "",
        site: veiculo || undefined,
        materia: true,
        publicadaEm: Number.isNaN(quando) ? undefined : new Date(quando).toISOString(),
      };
    })
    .filter((r) => r.titulo && /^https?:\/\//.test(r.url));
}

/** Só o que saiu nos últimos `dias`; sem data, fica (o agregador já ordena por recente). */
export function recentes<T extends { publicadaEm?: string }>(itens: T[], dias: number, agora = new Date()): T[] {
  const limite = agora.getTime() - dias * 86_400_000;
  return itens.filter((r) => !r.publicadaEm || Date.parse(r.publicadaEm) >= limite);
}

export function enderecoDoRss(fonte: FonteRss, tema: string, dias: number): string {
  const q = encodeURIComponent(tema.trim());
  return fonte === "bing"
    ? `https://www.bing.com/news/search?q=${q}&format=rss&setlang=pt-BR&cc=BR`
    : `https://news.google.com/rss/search?q=${q}+when:${dias}d&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}
