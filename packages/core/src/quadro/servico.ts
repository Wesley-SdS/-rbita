import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { user } from "@orbita/db/auth-schema";
import { chamarFerramentaMcpPeloDono, lerFerramentaMcp } from "../mcp/client";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { moverNoQuadro, quadroDaGestao, quadroDeChamados, type FaseDaGestao, type QualQuadro, type Quadro } from "./regras";
import type { RegraDoPrazo } from "../comigo/regras";

/**
 * O quadro da Adalink: lê pelos servidores MCP cadastrados em Extensões (os
 * mesmos de "Com você", `comigo.servidor*`) e move o card no sistema de origem.
 *
 * Mover é efeito externo. Chega aqui por dois caminhos, os dois com o dono no
 * comando: ele arrastou o card na tela, ou aprovou a proposta que a tool
 * `mover_card` enfileirou (chat e voz). O modelo sozinho nunca move nada.
 */

const cache = new Map<string, { em: number; quadro: Quadro }>();
const chave = (userId: string, qual: QualQuadro) => `${userId}:${qual}`;
/** o catálogo de fases muda raramente: vale o mesmo tempo do catálogo de tools MCP */
const fasesEmCache = new Map<string, { em: number; fases: FaseDaGestao[] }>();

async function regraDoPrazo(): Promise<RegraDoPrazo> {
  const cfg = await settings.getMany(["connectors.fusoHorario", "comigo.pertoPercentual", "comigo.pertoHoras"]);
  return { fuso: cfg["connectors.fusoHorario"] || "America/Sao_Paulo", percentualPerto: cfg["comigo.pertoPercentual"], horasPerto: cfg["comigo.pertoHoras"] };
}

async function servidor(qual: QualQuadro): Promise<string> {
  const nome = (await settings.get(qual === "chamados" ? "comigo.servidorTickets" : "comigo.servidorGestao")).trim();
  if (!nome) throw new Error(`O quadro de ${qual === "chamados" ? "chamados" : "gestão"} está desligado em Ajustes (servidor vazio).`);
  return nome;
}

async function meuNome(userId: string): Promise<string> {
  const configurado = (await settings.get("comigo.meuNome")).trim();
  if (configurado) return configurado;
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return u?.name ?? "";
}

async function fasesDaGestao(userId: string, nome: string): Promise<FaseDaGestao[]> {
  const guardado = fasesEmCache.get(userId);
  const validadeMs = (await settings.get("mcp.catalogRefreshHours")) * 3_600_000;
  if (guardado && Date.now() - guardado.em < validadeMs) return guardado.fases;
  const r = (await lerFerramentaMcp(userId, nome, "list_catalogs", { type: "activity_phase" })) as { items?: { id?: string; label?: string; sortOrder?: number }[] } | null;
  const fases = (r?.items ?? [])
    .filter((f) => f.id && f.label)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((f) => ({ id: f.id!, label: f.label! }));
  if (fases.length) fasesEmCache.set(userId, { em: Date.now(), fases });
  return fases;
}

/** Em lotes: dezenas de atividades não viram dezenas de chamadas de uma vez na gestão. */
async function emLotes<T, R>(itens: T[], tamanho: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  return saida;
}

async function lerGestao(userId: string, agora: Date, regra: RegraDoPrazo): Promise<Quadro> {
  const nome = await servidor("gestao");
  const [fases, meuDia] = await Promise.all([fasesDaGestao(userId, nome), lerFerramentaMcp(userId, nome, "get_my_day")]);
  const doDia = meuDia && typeof meuDia === "object" ? (meuDia as Record<string, unknown>) : {};
  const itens = Object.values(doDia).flatMap((v) => (Array.isArray(v) ? v : [])).filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object" && typeof (a as { id?: unknown }).id === "string");
  const unicos = [...new Map(itens.map((a) => [a.id as string, a])).values()];
  // o "meu dia" não traz a fase do projeto: ela vem do detalhe de cada atividade
  const comFase = await emLotes(unicos, await settings.get("comigo.detalhesEmParalelo"), async (a) => {
    try {
      const d = (await lerFerramentaMcp(userId, nome, "get_activity", { activityId: a.id })) as { phase?: string } | null;
      return { ...a, phase: d?.phase ?? null };
    } catch (e) {
      log.warn("quadro.atividade_sem_detalhe", { atividade: a.id, erro: e instanceof Error ? e.message : String(e) });
      return { ...a, phase: null };
    }
  });
  return quadroDaGestao(fases, comFase, agora, regra);
}

export async function lerQuadro(userId: string, qual: QualQuadro, opts: { fresco?: boolean } = {}): Promise<Quadro> {
  const validadeMs = (await settings.get("comigo.cacheSegundos")) * 1000;
  const guardado = cache.get(chave(userId, qual));
  if (!opts.fresco && guardado && Date.now() - guardado.em < validadeMs) return guardado.quadro;
  const agora = new Date();
  const regra = await regraDoPrazo();
  const quadro =
    qual === "chamados"
      ? quadroDeChamados(await lerFerramentaMcp(userId, await servidor("chamados"), "tickets_board"), await meuNome(userId), agora, regra)
      : await lerGestao(userId, agora, regra);
  cache.set(chave(userId, qual), { em: Date.now(), quadro });
  return quadro;
}

/**
 * Move o card para a coluna, no sistema de origem. Confere ANTES, no quadro
 * lido agora, que o card e a coluna existem: a coluna vem do clique ou da
 * proposta, e um id inventado não pode virar uma fase qualquer lá.
 */
export async function moverCard(userId: string, qual: QualQuadro, cardId: string, colunaId: string): Promise<{ card: string; coluna: string }> {
  const quadro = await lerQuadro(userId, qual, { fresco: true });
  const card = quadro.colunas.flatMap((c) => c.cards).find((c) => c.id === cardId);
  const coluna = quadro.colunas.find((c) => c.id === colunaId && c.id !== "?");
  if (!card) throw new Error("Esse card não está mais no quadro.");
  if (!coluna) throw new Error("Essa coluna não existe no quadro.");
  if (qual === "chamados") {
    await chamarFerramentaMcpPeloDono(userId, await servidor("chamados"), "tickets_update", { ticket: card.id, status: coluna.id });
  } else {
    await chamarFerramentaMcpPeloDono(userId, await servidor("gestao"), "update_activity_status", { activityId: card.id, phase: coluna.id });
  }
  // o que a tela vê agora já é o novo estado; a próxima leitura confirma no sistema
  cache.set(chave(userId, qual), { em: Date.now(), quadro: moverNoQuadro(quadro, card.id, coluna.id) });
  log.info("quadro.moveu", { userId, qual, card: card.codigo ?? card.id, coluna: coluna.rotulo });
  return { card: `${card.codigo ? `${card.codigo} ` : ""}${card.titulo}`, coluna: coluna.rotulo };
}
