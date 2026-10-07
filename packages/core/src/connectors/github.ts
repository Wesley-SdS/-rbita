/**
 * Cliente REST do GitHub, só LEITURA (conectado por token, `por-token.ts`).
 *
 * O dono quer saber o que chegou nas PRs DELE (review, comentário) e quais PRs
 * esperam o review dele. A API de notificações seria o caminho óbvio, mas o
 * token fine-grained não tem acesso a ela; a busca (`is:pr author:@me`) e os
 * três tipos de comentário de uma PR funcionam com os dois tipos de token.
 */

async function gh<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "orbita" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export interface PrDoGithub {
  id: number;
  repo: string;
  numero: number;
  titulo: string;
  url: string;
  autor: string;
  atualizadaEm: string;
  rascunho: boolean;
}

interface ItemDaBusca {
  id: number;
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  updated_at: string;
  draft?: boolean;
  user?: { login?: string };
}

const paraPr = (i: ItemDaBusca): PrDoGithub => ({
  id: i.id,
  repo: i.repository_url.split("/repos/")[1] ?? "",
  numero: i.number,
  titulo: i.title,
  url: i.html_url,
  autor: i.user?.login ?? "",
  atualizadaEm: i.updated_at,
  rascunho: Boolean(i.draft),
});

async function buscarPrs(token: string, filtro: string, max: number): Promise<PrDoGithub[]> {
  const q = encodeURIComponent(`is:pr is:open archived:false ${filtro}`);
  const r = await gh<{ items?: ItemDaBusca[] }>(token, `/search/issues?q=${q}&sort=updated&order=desc&per_page=${max}`);
  return (r.items ?? []).map(paraPr);
}

/** As PRs abertas do dono, as mais mexidas primeiro. */
export const minhasPrs = (token: string, max = 20) => buscarPrs(token, "author:@me", max);

/** As PRs em que pediram o review do dono. */
export const prsEsperandoMeuReview = (token: string, max = 20) => buscarPrs(token, "review-requested:@me", max);

const loginEmCache = new Map<string, string>();

export async function meuLogin(token: string, chave: string): Promise<string> {
  const c = loginEmCache.get(chave);
  if (c) return c;
  const eu = await gh<{ login: string }>(token, "/user");
  loginEmCache.set(chave, eu.login);
  return eu.login;
}

export interface NovidadeDaPr {
  eventoId: string;
  tipo: "review" | "comentario";
  autor: string;
  estado: string | null;
  texto: string;
  url: string;
  quando: string;
}

interface Comentario {
  id: number;
  body?: string | null;
  html_url: string;
  created_at?: string;
  submitted_at?: string;
  state?: string;
  user?: { login?: string; type?: string };
}

/**
 * O que chegou numa PR desde um instante: reviews, comentários de linha e
 * comentários da conversa. Fica de fora o que o próprio dono escreveu e o que
 * é de robô (CI, cobertura): avisar disso seria ruído.
 */
export async function novidadesDaPr(token: string, pr: PrDoGithub, desde: Date, eu: string): Promise<NovidadeDaPr[]> {
  const iso = desde.toISOString();
  const [reviews, deLinha, daConversa] = await Promise.all([
    gh<Comentario[]>(token, `/repos/${pr.repo}/pulls/${pr.numero}/reviews?per_page=50`),
    gh<Comentario[]>(token, `/repos/${pr.repo}/pulls/${pr.numero}/comments?since=${iso}&per_page=50`),
    gh<Comentario[]>(token, `/repos/${pr.repo}/issues/${pr.numero}/comments?since=${iso}&per_page=50`),
  ]);
  const deGente = (c: Comentario) => c.user?.login && c.user.login.toLowerCase() !== eu.toLowerCase() && c.user.type !== "Bot";
  const novidades: NovidadeDaPr[] = [];
  for (const r of reviews) {
    // review "COMMENTED" sem texto é só o envelope dos comentários de linha, que já entram abaixo
    if (!deGente(r) || !r.submitted_at || new Date(r.submitted_at) < desde || (r.state === "COMMENTED" && !r.body?.trim())) continue;
    novidades.push({ eventoId: `review:${r.id}`, tipo: "review", autor: r.user!.login!, estado: r.state ?? null, texto: (r.body ?? "").trim(), url: r.html_url, quando: r.submitted_at });
  }
  // comentário de linha e de conversa moram em tabelas diferentes: o mesmo número pode aparecer nas duas
  for (const [origem, c] of [...deLinha.map((c) => ["linha", c] as const), ...daConversa.map((c) => ["conversa", c] as const)]) {
    if (!deGente(c) || !c.created_at || new Date(c.created_at) < desde) continue;
    novidades.push({ eventoId: `${origem}:${c.id}`, tipo: "comentario", autor: c.user!.login!, estado: null, texto: (c.body ?? "").trim(), url: c.html_url, quando: c.created_at });
  }
  return novidades;
}
