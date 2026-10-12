import { and, asc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { navegadorSite, type NavegadorSite } from "@orbita/db/navegador-schema";
import { settings } from "../settings";
import { normalizarSite } from "../controle/envelope";
import type { RegraDeSitesDaExtensao } from "./protocolo";
import { casaDominio, categoriaBloqueada, origensDaOrbita, padroesBloqueados, partesDaUrl, portasDaOrbita, type Categoria } from "./categorias";

/**
 * O MODO DE CADA SITE (PRD B2): bloqueado, leitura ou escrita.
 *
 * A ordem da decisão, do mais forte ao mais fraco:
 *   1. categoria bloqueada (bancos, senhas, webmail, contas, o navegador, a Órbita);
 *   2. a linha do dono em `navegador_site` (o domínio mais específico vence);
 *   3. `navegador.padraoSite`.
 *
 * Só muda pela tela (OwnerGuard). Não existe tool que mexa aqui (PRD §2.3).
 */

export const MODOS = ["bloqueado", "leitura", "escrita"] as const;
export type ModoDoSite = (typeof MODOS)[number];

export interface DecisaoDoSite {
  modo: ModoDoSite;
  /** de onde veio: categoria, linha do dono ou o padrão */
  fonte: "categoria" | "lista" | "padrao";
  categoria?: Categoria;
  /** o dono classificou este domínio explicitamente (leitura ou escrita): é o que libera ler por URL sem aprovação */
  explicito: boolean;
}

export interface RegrasDeSite {
  categorias: string[];
  bancos: string[];
  origensDaOrbita: string[];
  /** as portas em que a Órbita responde nesta máquina (padrão mais as do ambiente) */
  portasDaOrbita?: number[];
  padrao: ModoDoSite;
  linhas: { dominio: string; modo: string }[];
}

const ehModo = (v: string): v is ModoDoSite => (MODOS as readonly string[]).includes(v);

/** A decisão para uma URL, com as regras já carregadas. Puro. */
export function decidirSite(url: string, r: RegrasDeSite): DecisaoDoSite {
  const cat = categoriaBloqueada(url, { categorias: r.categorias, bancos: r.bancos, origensDaOrbita: r.origensDaOrbita, portasDaOrbita: r.portasDaOrbita });
  if (cat) return { modo: "bloqueado", fonte: "categoria", categoria: cat, explicito: false };
  if (url === "about:blank" || url === "") return { modo: "leitura", fonte: "padrao", explicito: false };
  const partes = partesDaUrl(url);
  if (!partes) return { modo: "bloqueado", fonte: "categoria", categoria: "navegador", explicito: false };
  // o mais específico vence: "docs.empresa.com" escrita e "empresa.com" leitura
  const casadas = r.linhas.filter((l) => casaDominio(partes, l.dominio)).sort((a, b) => b.dominio.length - a.dominio.length);
  const linha = casadas[0];
  if (linha && ehModo(linha.modo)) return { modo: linha.modo, fonte: "lista", explicito: linha.modo !== "bloqueado" };
  return { modo: r.padrao, fonte: "padrao", explicito: false };
}

export async function regrasDeSite(userId: string): Promise<RegrasDeSite> {
  const [cfg, linhas] = await Promise.all([
    settings.getMany(["navegador.categoriasBloqueadas", "navegador.padraoSite", "emails.bancos", "navegador.sitesDeBanco"]),
    db.select({ dominio: navegadorSite.dominio, modo: navegadorSite.modo }).from(navegadorSite).where(eq(navegadorSite.userId, userId)),
  ]);
  return {
    categorias: cfg["navegador.categoriasBloqueadas"],
    // os remetentes de E-mails (bancos) e os endereços de internet banking (a lista do Chrome)
    bancos: [...new Set([...(cfg["emails.bancos"] ?? []), ...(cfg["navegador.sitesDeBanco"] ?? [])])],
    origensDaOrbita: origensDaOrbita(process.env),
    portasDaOrbita: portasDaOrbita(process.env),
    padrao: ehModo(cfg["navegador.padraoSite"]) ? cfg["navegador.padraoSite"] : "leitura",
    linhas,
  };
}

export async function modoDoSite(userId: string, url: string): Promise<DecisaoDoSite> {
  return decidirSite(url, await regrasDeSite(userId));
}

/** O que a extensão recusa sozinha: as categorias, os domínios que o dono bloqueou e, com o padrão "bloqueado", tudo que não estiver liberado. Puro. */
export function regraParaExtensao(r: RegrasDeSite): RegraDeSitesDaExtensao {
  const bloqueados = padroesBloqueados({ categorias: r.categorias, bancos: r.bancos, origensDaOrbita: r.origensDaOrbita });
  for (const l of r.linhas) if (l.modo === "bloqueado") bloqueados.push(l.dominio);
  return {
    bloqueados: [...new Set(bloqueados)],
    liberados: r.linhas.filter((l) => l.modo !== "bloqueado").map((l) => l.dominio),
    escrita: r.linhas.filter((l) => l.modo === "escrita").map((l) => l.dominio),
    padraoBloqueado: r.padrao === "bloqueado",
    ...(r.portasDaOrbita ? { portasDaOrbita: r.portasDaOrbita } : {}),
  };
}

export async function listarSites(userId: string): Promise<NavegadorSite[]> {
  return db.select().from(navegadorSite).where(eq(navegadorSite.userId, userId)).orderBy(asc(navegadorSite.dominio));
}

export class SiteInvalidoError extends Error {
  status = 400;
}

export async function definirSite(userId: string, dominioBruto: string, modo: ModoDoSite): Promise<NavegadorSite> {
  const sufixos = await settings.get("navegador.sufixosPublicos").catch(() => undefined);
  const dominio = normalizarSite(dominioBruto, sufixos ?? undefined);
  if (!dominio) throw new SiteInvalidoError(`"${dominioBruto.slice(0, 80)}" não é um site (exemplo: jira.atlassian.net). Sufixo sozinho, como com.br ou github.io, vale para sites de muita gente e não entra.`);
  const [l] = await db
    .insert(navegadorSite)
    .values({ userId, dominio, modo })
    .onConflictDoUpdate({ target: [navegadorSite.userId, navegadorSite.dominio], set: { modo } })
    .returning();
  return l!;
}

export async function removerSite(userId: string, id: string): Promise<boolean> {
  const r = await db.delete(navegadorSite).where(and(eq(navegadorSite.id, id), eq(navegadorSite.userId, userId))).returning({ id: navegadorSite.id });
  return r.length > 0;
}
