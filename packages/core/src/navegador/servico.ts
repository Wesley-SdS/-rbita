import { settings } from "../settings";
import { siteNoEnvelope } from "../controle/envelope";
import { sessaoParaTipo } from "../controle/sessao";
import type { ControleSessao } from "@orbita/db/controle-schema";
import { ErroDoNavegador, ordemAoNavegador, type Perfil } from "./ordens";
import { lembrarLinks } from "./leitura";
import type { DescricaoDoAlvo, Leitura } from "./pagina";
import type { AbaVista, OrigemDaOrdem, ResultadoDaOrdem } from "./protocolo";
import { decidirSite, regrasDeSite, type DecisaoDoSite } from "./sites";

/**
 * As operações do Chrome que as tools e o laço delegado usam, com a trava do
 * CORE por cima da trava das mãos: depois de a extensão (ou o perfil dedicado)
 * responder, o endereço da aba é conferido de novo contra o modo do site, e
 * nada de site bloqueado (nem o título) segue para o modelo.
 */

export interface Destino {
  userId: string;
  origem: OrigemDaOrdem;
  perfil: Perfil;
}

export async function sessaoDoNavegador(userId: string): Promise<ControleSessao | null> {
  return sessaoParaTipo(userId, "navegador").catch(() => null);
}

/** O domínio de uma URL ("" quando não dá para ler). */
export function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Abas com as de site bloqueado sem título nem endereço (conferido aqui também). */
export async function abasFiltradas(d: Destino): Promise<AbaVista[]> {
  const [r, regras] = await Promise.all([ordemAoNavegador(d.userId, { tipo: "abas" }, d), regrasDeSite(d.userId)]);
  return (r.abas ?? []).map((a) => (a.bloqueada || decidirSite(a.url, regras).modo === "bloqueado" ? { aba: a.aba, titulo: "", url: "", ativa: a.ativa, noGrupo: a.noGrupo, bloqueada: true } : a));
}

export interface PedidoDeLeitura {
  aba?: number | null;
  modo: "texto" | "arvore" | "ambos";
  filtro: "interativos" | "visiveis" | "tudo";
  ref?: string | null;
}

export type LeituraConferida = { bloqueada: true; aba?: number } | { bloqueada: false; aba?: number; leitura: Leitura; site: DecisaoDoSite };

/** Lê a aba e confere o site da RESPOSTA (o endereço pode ter mudado desde o pedido). */
export async function lerAba(d: Destino, p: PedidoDeLeitura): Promise<LeituraConferida> {
  const cfg = await settings.getMany(["navegador.textoMaxCaracteres", "navegador.elementosMax"]);
  const r = await ordemAoNavegador(d.userId, { tipo: "ler", aba: p.aba ?? null, modo: p.modo, filtro: p.filtro, ref: p.ref ?? null, maxCaracteres: cfg["navegador.textoMaxCaracteres"], maxElementos: cfg["navegador.elementosMax"] }, d);
  if (r.bloqueada || !r.leitura) return { bloqueada: true, aba: r.aba };
  const site = decidirSite(r.leitura.url, await regrasDeSite(d.userId));
  if (site.modo === "bloqueado") return { bloqueada: true, aba: r.aba };
  lembrarLinks(d.userId, r.leitura.links);
  // os links ficam no core: nunca vão ao modelo
  const { links: _fora, ...leitura } = r.leitura;
  return { bloqueada: false, aba: r.aba, leitura, site };
}

/** O alvo (por ref ou por ponto) e a URL da aba, conferidos. */
export async function descreverAlvo(d: Destino, p: { aba?: number | null; ref?: string | null; x?: number | null; y?: number | null }): Promise<{ alvo: DescricaoDoAlvo | null; url: string; aba?: number }> {
  const r = await ordemAoNavegador(d.userId, { tipo: "descrever", aba: p.aba ?? null, ref: p.ref ?? null, x: p.x ?? null, y: p.y ?? null }, d);
  return { alvo: r.alvo ?? null, url: r.url ?? "", aba: r.aba };
}

export async function focadoNaAba(d: Destino, aba?: number | null): Promise<{ focado: DescricaoDoAlvo | null; url: string; aba?: number }> {
  const r = await ordemAoNavegador(d.userId, { tipo: "focado", aba: aba ?? null }, d);
  return { focado: r.alvo ?? null, url: r.url ?? "", aba: r.aba };
}

/** O domínio está no envelope da sessão ATIVA, ou o dono o liberou para agir (modo escrita)? */
export async function autorizadoAgir(userId: string, url: string): Promise<{ noEnvelope: boolean; site: DecisaoDoSite; sessao: ControleSessao | null }> {
  const [sessao, regras] = await Promise.all([sessaoDoNavegador(userId), regrasDeSite(userId)]);
  const site = decidirSite(url, regras);
  const dominio = dominioDe(url);
  const noEnvelope = site.modo !== "bloqueado" && !!dominio && ((!!sessao && siteNoEnvelope(dominio, sessao.sites)) || site.modo === "escrita");
  return { noEnvelope, site, sessao };
}

export function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroDoNavegador) return e.message;
  return e instanceof Error ? e.message.slice(0, 300) : "O Chrome não conseguiu.";
}

export type { ResultadoDaOrdem };
