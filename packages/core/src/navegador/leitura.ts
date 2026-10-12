import { embrulharDadoExterno } from "../texto/dado-externo";
import type { ElementoLido, Leitura } from "./pagina";
import type { AbaVista } from "./protocolo";
import { chaveDeUrl } from "./risco";

/**
 * O QUE DA PÁGINA CHEGA AO MODELO (PRD §5.5, B2): a leitura já sanitizada na
 * página vira texto no formato que o Claude conhece (`button "Enviar" [ref_3]`,
 * o mesmo do `read_page` do toolset dele), sempre EMBRULHADO como dado
 * externo: quem escreveu a página não dá ordem à Órbita.
 */

const CONTROLE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]", "g");

/** Título de aba sem caractere de controle nem quebra (o título também é da página). Puro. */
export function tituloLimpo(t: string): string {
  return t.replace(CONTROLE, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Nome de parâmetro com cara de segredo: link mágico, OAuth, assinatura de URL, sessão. */
const PARAMETRO_SECRETO = /(^|[_-])(token|code|key|sig|signature|auth|session|sess|sid|access_token|id_token|refresh_token|secret|password|senha|otp|ticket|nonce|state|jwt|credential|apikey|api_key)([_-]|$)|^(x-amz-[a-z-]+|x-goog-[a-z-]+)$/i;

/**
 * O endereço como vai ao modelo (I-6 e os menores): sem o fragmento (o vetor
 * do HashJack) e com o VALOR de parâmetro que tem cara de segredo trocado por
 * "[oculto]". Um link mágico de login (`?token=…`) ou a volta de um OAuth
 * (`?code=…&state=…`) na barra de endereço chegava inteiro ao modelo, e o
 * modelo podia repetir o código numa URL montada. Puro.
 */
export function urlParaModelo(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.replace(/#.*$/, "").slice(0, 2000);
  }
  u.hash = "";
  const params = [...u.searchParams.keys()];
  for (const k of new Set(params)) if (PARAMETRO_SECRETO.test(k)) u.searchParams.set(k, "[oculto]");
  // o segredo também mora no usuário e senha embutidos (https://user:pass@host)
  u.username = u.username ? "[oculto]" : "";
  u.password = "";
  return u.toString().replace(/%5Boculto%5D/gi, "[oculto]").replace(/\/$/, "").slice(0, 2000);
}

/** Uma linha por elemento, indentada pelo marco em que ele está. Puro. */
export function linhaDoElemento(e: ElementoLido): string {
  const nome = e.nome.replace(/"/g, "'");
  let l = `${"  ".repeat(Math.min(e.nivel, 6))}${e.papel}${nome ? ` "${nome}"` : ""} [${e.ref}]`;
  if (e.valor) l += ` valor="${e.valor.replace(/"/g, "'")}"`;
  if (e.estados?.length) l += ` (${e.estados.join(", ")})`;
  return l;
}

export function arvoreEmTexto(elementos: readonly ElementoLido[], truncado?: boolean): string {
  const linhas = elementos.map(linhaDoElemento);
  if (truncado) linhas.push(`(cortado em ${elementos.length} elementos: leia um trecho com ref, ou role a página)`);
  return linhas.join("\n");
}

const AVISO_DE_BLOQUEIO: Record<NonNullable<Leitura["bloqueio"]>, string> = {
  login: "A página pede LOGIN. A Órbita nunca digita senha: peça ao dono para entrar e espere a página mudar.",
  captcha: "A página tem um CAPTCHA. A Órbita não resolve captcha: peça ao dono.",
  "2fa": "A página pede um CÓDIGO de verificação (segundo fator). A Órbita não digita código: peça ao dono.",
};

export function avisoDeBloqueio(b: Leitura["bloqueio"]): string | null {
  return b ? AVISO_DE_BLOQUEIO[b] : null;
}

/** A leitura inteira no formato do modelo, embrulhada. Puro. */
export function leituraParaModelo(l: Leitura): string {
  const partes = [`Página: ${tituloLimpo(l.titulo)}`, `Endereço: ${urlParaModelo(l.url)}`];
  if (l.elementos) partes.push("", "Elementos (use a ref para agir):", arvoreEmTexto(l.elementos, l.elementosTruncados) || "(nenhum elemento visível)");
  if (l.texto !== undefined) partes.push("", "Texto:", l.texto + (l.textoTruncado ? " (…cortado)" : ""));
  return embrulharDadoExterno("pagina", partes.join("\n"));
}

/** As abas no formato do modelo, com as bloqueadas sem título nem endereço, embrulhadas. Puro. */
export function abasParaModelo(abas: readonly AbaVista[]): string {
  const linhas = abas.map((a) => {
    if (a.bloqueada) return `aba ${a.aba}${a.ativa ? " (atual)" : ""}: site bloqueado`;
    let dominio = "";
    try {
      dominio = new URL(a.url).hostname;
    } catch {
      dominio = a.url.slice(0, 60);
    }
    return `aba ${a.aba}${a.ativa ? " (atual)" : ""}${a.noGrupo ? " [grupo da Órbita]" : ""}: "${tituloLimpo(a.titulo)}" (${dominio})`;
  });
  return embrulharDadoExterno("abas", linhas.join("\n") || "(nenhuma aba)");
}

// ── memória curta: os links que a Órbita VIU (abrir um deles não é URL montada) ──
const LINKS_MAX = 2000;
const linksVistos = new Map<string, Set<string>>();

export function lembrarLinks(userId: string, links: readonly string[] | undefined): void {
  if (!links?.length) return;
  let s = linksVistos.get(userId);
  if (!s) linksVistos.set(userId, (s = new Set()));
  for (const l of links) {
    if (s.size >= LINKS_MAX) s.delete(s.values().next().value as string);
    s.add(chaveDeUrl(l));
  }
}

/** O endereço foi visto como link numa página lida, ou está escrito no pedido do dono. */
export function urlConhecida(userId: string, url: string, pedido?: string | null): boolean {
  const k = chaveDeUrl(url);
  if (linksVistos.get(userId)?.has(k)) return true;
  return !!pedido && pedido.includes(url.replace(/#.*$/, ""));
}

/** Só para testes. */
export function _esquecerLinks(): void {
  linksVistos.clear();
}
