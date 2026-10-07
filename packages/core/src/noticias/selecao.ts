import { minutosDe, type AgoraLocal } from "../whatsapp/horario";

/**
 * O que é notícia NOVA para o dono, e quando a busca do dia vence. Puro.
 *
 * A busca na web devolve a mesma matéria por vários caminhos (com e sem
 * `www`, com `?utm_source=…`, a mesma manchete reproduzida por outro site). O
 * feed só vale se não repetir: o que já foi mostrado não volta amanhã.
 */

export interface ResultadoDaBusca {
  titulo: string;
  url: string;
  trecho: string;
  /** nome do veículo, quando a fonte diz ("Canaltech"); sem ele, o domínio */
  site?: string;
  /** veio de um agregador de notícias: é matéria, sem precisar adivinhar pelo endereço */
  materia?: boolean;
  publicadaEm?: string;
}

export interface Candidata {
  titulo: string;
  url: string;
  site: string;
  trecho: string;
}

/** O endereço sem o que muda de um compartilhamento para outro (rastreio, `www`, barra final). */
export function urlCanonica(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|ocid)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const palavrasDaManchete = (t: string) =>
  new Set(t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));

/**
 * A mesma manchete reproduzida por outro site ("IA aprova remédio" e "IA
 * aprova remédio no Brasil"): 80% das palavras da menor estão na outra.
 * Manchete curta demais (menos de 4 palavras) não é comparada: "Bolsa hoje"
 * casaria com metade do noticiário.
 */
export function mesmaManchete(a: string, b: string): boolean {
  const pa = palavrasDaManchete(a);
  const pb = palavrasDaManchete(b);
  const [menor, maior] = pa.size <= pb.size ? [pa, pb] : [pb, pa];
  if (menor.size < 4) return false;
  let comuns = 0;
  for (const w of menor) if (maior.has(w)) comuns++;
  return comuns / menor.size >= 0.8;
}

/**
 * Parece uma MATÉRIA, e não a página de seção que lista matérias? A busca por
 * tema devolve muito índice ("Inteligência Artificial: últimas notícias -
 * Exame", "Notícias sobre IA - VEJA"), e o primeiro teste real (06/10/2026)
 * trouxe cinco assim. Matéria tem caminho com cara de matéria: data, id
 * numérico ou um final com cara de manchete (vários termos ligados por
 * hífen); e título que não é o nome da seção. A profundidade não ajuda:
 * "/economia/money/inteligencia-artificial" é seção com três pedaços.
 */
export function pareceMateria(url: string, titulo: string): boolean {
  let caminho: string[];
  try {
    caminho = new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return false;
  }
  if (!caminho.length) return false;
  if (caminho.some((p) => /^(tag|tags|tema|temas|topico|topicos|topics?|categoria|categorias|category|secao|editoria|assunto|autor|busca|search|tudo-sobre|noticias-sobre|ultimas-noticias)$/i.test(p))) return false;
  const ultimo = caminho[caminho.length - 1]!.replace(/\.(s?html?|php|aspx?)$/i, '');
  const temData = /(19|20)\d{2}[\/-]?\d{2}/.test(url);
  const temId = caminho.some((p) => /\d{5,}/.test(p));
  const slugDeMateria = (ultimo.match(/-/g) ?? []).length >= 3;
  if (!temData && !temId && !slugDeMateria) return false;
  if (/(últimas notícias|ultimas noticias|notícias sobre|noticias sobre|todas as notícias|notícias e novidades|^notícias de )/i.test(titulo)) return false;
  return true;
}

/**
 * As candidatas novas: link válido, nunca vista (`jaVistas` são URLs
 * canônicas), sem repetir link nem manchete dentro do próprio lote.
 */
export function novasNoticias(resultados: ResultadoDaBusca[], jaVistas: ReadonlySet<string>, max: number): Candidata[] {
  const vistasAgora = new Set<string>();
  const saida: Candidata[] = [];
  for (const r of resultados) {
    const url = urlCanonica(r.url ?? "");
    const titulo = (r.titulo ?? "").trim();
    if (!url || !titulo || jaVistas.has(url) || vistasAgora.has(url) || (!r.materia && !pareceMateria(url, titulo))) continue;
    if (saida.some((c) => mesmaManchete(c.titulo, titulo))) continue;
    vistasAgora.add(url);
    saida.push({ titulo, url, site: r.site?.trim() || new URL(url).hostname, trecho: (r.trecho ?? "").replace(/\s+/g, " ").trim() });
    if (saida.length >= max) break;
  }
  return saida;
}

/**
 * Junta a avaliação do modelo às candidatas: sai o que ele disse que não é do
 * tema; sem resumo (ou sem avaliação para aquela), fica o trecho da busca.
 * Travessão vira vírgula (CLAUDE.md §6). Puro.
 */
export function aplicarAvaliacao(candidatas: Candidata[], avaliacao: { n: number; doTema: boolean; resumo: string }[]): { candidata: Candidata; resumo: string }[] {
  const porNumero = new Map(avaliacao.map((x) => [x.n, x]));
  return candidatas
    .map((c, i) => ({ c, a: porNumero.get(i + 1) }))
    .filter(({ a }) => !a || a.doTema)
    .map(({ c, a }) => ({ candidata: c, resumo: (a?.resumo?.trim() || c.trecho).replace(/\s*[—–]\s*/g, ", ").slice(0, 400) }));
}

/** A busca do dia do tema já venceu? Uma por dia, a partir do horário escolhido. */
export function buscaDevida(agora: AgoraLocal, horario: string, ultimoDia: string | null): boolean {
  if (ultimoDia === agora.dia) return false;
  const alvo = minutosDe(horario);
  return alvo !== null && agora.minutos >= alvo;
}

/** O que vai para o buscador: o tema, puxando para notícia recente. */
export const consultaDoTema = (tema: string, mes?: string) => `${tema.trim()} notícias${mes ? ` ${mes}` : ""}`;
