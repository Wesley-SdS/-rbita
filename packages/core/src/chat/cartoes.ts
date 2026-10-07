/**
 * O que um resultado de tool MOSTRA na tela, além do que a Órbita fala.
 *
 * O chat de texto e o tempo real chegam ao mesmo resultado por caminhos
 * diferentes (stream do servidor de um lado, chamada de função vinda do
 * Gemini ou da OpenAI do outro), e a tela tem de reagir igual nos dois. Era só
 * o chat que sabia montar o cartão de aprovação, e no tempo real a Órbita
 * dizia "deixei a mensagem pronta, é só dizer manda" sem cartão nenhum para
 * conferir (05/10/2026). E a busca na web falava a notícia sem mostrar de onde
 * ela veio. Puro: roda no navegador e no servidor.
 */

export interface FonteDaWeb {
  titulo: string;
  url: string;
  trecho: string;
  /** "g1.globo.com": quem conta a notícia, que é o que o dono quer ver primeiro */
  site: string;
}

export interface PropostaDaTool {
  id: string;
  kind: string;
  resumo: string;
  payload: Record<string, unknown>;
}

/** Teto de cards: a busca traz 5 por padrão; mais que isso vira parede. */
const MAX_FONTES = 6;

function siteDe(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * As fontes de uma busca na web, pelo FORMATO do resultado e não pelo nome da
 * tool. São dois formatos:
 *
 * - o nosso (`pesquisar_web`): `{ resultados: [{ titulo, url, trecho }] }`;
 * - o da busca nativa do Claude (`web_search`, executada na Anthropic): uma
 *   LISTA de `{ url, title, pageAge }`. É ela que roda quando quem responde é
 *   o Claude (`chat/busca-nativa.ts`), e sem este formato os cards nunca
 *   apareciam no chat, só na voz (05/10/2026).
 *
 * Uma tool nova de busca ganha os cards de graça. Link que não é http(s) fica
 * de fora: o card vira link clicável, e `javascript:` vindo de uma página
 * qualquer não pode virar um.
 */
export function fontesDoResultado(resultado: unknown): FonteDaWeb[] {
  const lista = Array.isArray(resultado) ? resultado : (resultado as { resultados?: unknown } | null)?.resultados;
  if (!Array.isArray(lista)) return [];
  const fontes: FonteDaWeb[] = [];
  const vistas = new Set<string>();
  for (const r of lista) {
    const o = r as { titulo?: unknown; title?: unknown; url?: unknown; trecho?: unknown; snippet?: unknown };
    const titulo = typeof o?.titulo === "string" ? o.titulo : typeof o?.title === "string" ? o.title : "";
    const trecho = typeof o?.trecho === "string" ? o.trecho : typeof o?.snippet === "string" ? o.snippet : "";
    if (typeof o?.url !== "string" || !titulo.trim() || vistas.has(o.url)) continue;
    const site = siteDe(o.url);
    if (!site) continue;
    vistas.add(o.url);
    fontes.push({ titulo: titulo.trim(), url: o.url, trecho: trecho.trim(), site });
    if (fontes.length >= MAX_FONTES) break;
  }
  return fontes;
}

/**
 * A proposta que ficou esperando aprovação. O `payload` são os argumentos com
 * que o modelo chamou a tool: é o que o cartão mostra para conferir e corrigir.
 * A execução continua só no `POST /api/actions` (§5.1).
 */
export function propostaDoResultado(tool: string, resultado: unknown, argumentos: unknown): PropostaDaTool | null {
  const r = resultado as { proposta_enfileirada?: unknown; aguardando_aprovacao?: unknown; id?: unknown; resumo?: unknown } | null;
  if (!r || !(r.proposta_enfileirada || r.aguardando_aprovacao) || typeof r.id !== "string" || !r.id) return null;
  const payload = argumentos && typeof argumentos === "object" && !Array.isArray(argumentos) ? (argumentos as Record<string, unknown>) : {};
  return { id: r.id, kind: tool, resumo: typeof r.resumo === "string" ? r.resumo : "", payload };
}
