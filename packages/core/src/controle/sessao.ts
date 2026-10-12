import { hostname } from "node:os";
import { and, desc, eq, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { controleSessao, type ControleSessao } from "@orbita/db/controle-schema";
import { events } from "../events/index";
import { settings } from "../settings";
import { log } from "../observability/logger";
import type { ToolContext } from "../tools/registry";
import { conferirSessao, type AlvoDaAcao, type AlvoDaSessao } from "./envelope";
import { espelhar, type EnvelopeEspelhado } from "./espelho";
import type { TipoDeAlvo } from "./dominios";

/**
 * SESSÃO DE CONTROLE (PRD F2). Nasce ativa na execução aprovada do
 * `controle_iniciar` (a fila é onde o dono aprova), age dentro do envelope e
 * só sai de ativa para baixo: pausada (teto, tempo, vetos, o dono mexeu),
 * encerrada (o dono ou a Órbita terminou) ou parada (o botão, o atalho, o
 * "para"). Nenhuma função aqui amplia um envelope.
 *
 * Uma sessão por dono: abrir um envelope novo encerra o anterior.
 */

export const EVENTO = {
  iniciada: "controle.sessao_iniciada",
  pausada: "controle.sessao_pausada",
  encerrada: "controle.sessao_encerrada",
  parado: "controle.parado",
} as const;

export type StatusDaSessao = "ativa" | "pausada" | "encerrada" | "parada";

export interface EnvelopeAprovado {
  alvo: AlvoDaSessao;
  objetivo: string;
  pedidoOriginal: string;
  pedidoLiteral: boolean;
  apps: string[];
  sites: string[];
  tetoPassos: number;
  tetoMinutos: number;
  canal: string;
  maquina?: string;
}

/** O PC que esta Órbita controla. Na v1 é o do apps/api (PRD §15). */
export function maquinaLocal(): string {
  return hostname().slice(0, 120) || "este-pc";
}

export function envelopeEspelhado(s: ControleSessao): EnvelopeEspelhado {
  return {
    sessaoId: s.id,
    alvo: s.alvo as AlvoDaSessao,
    objetivo: s.objetivo,
    apps: s.apps,
    sites: s.sites,
    tetoPassos: s.tetoPassos,
    passosUsados: s.passosUsados,
    expiraEm: s.expiraEm.toISOString(),
    maquina: s.maquina,
  };
}

async function prazoDoEspelho(): Promise<number> {
  return settings.get("controle.espelhoTimeoutMs").catch(() => 1500);
}

/** A sessão ativa (ou a última pausada, se `incluirPausada`) do dono. */
export async function sessaoAtual(userId: string, incluirPausada = false): Promise<ControleSessao | null> {
  const [s] = await db
    .select()
    .from(controleSessao)
    .where(and(eq(controleSessao.userId, userId), inArray(controleSessao.status, incluirPausada ? ["ativa", "pausada"] : ["ativa"])))
    .orderBy(desc(controleSessao.criadaEm))
    .limit(1);
  return s ?? null;
}

/**
 * Tira a sessão de ATIVA (ou de pausada, para encerrar ou parar), avisa as
 * mãos e emite o evento. A troca é condicional ao status atual: duas origens
 * (o teto e o "para") ao mesmo tempo não emitem dois fins.
 */
export async function terminarSessao(userId: string, sessaoId: string, status: Exclude<StatusDaSessao, "ativa">, motivo: string): Promise<ControleSessao | null> {
  const de: StatusDaSessao[] = status === "pausada" ? ["ativa"] : ["ativa", "pausada"];
  const [s] = await db
    .update(controleSessao)
    .set({ status, motivo: motivo.slice(0, 200), atualizadaEm: new Date(), terminadaEm: status === "pausada" ? null : new Date() })
    .where(and(eq(controleSessao.id, sessaoId), eq(controleSessao.userId, userId), inArray(controleSessao.status, de)))
    .returning();
  if (!s) return null;
  log.info("controle.sessao_fim", { userId, sessaoId, status, motivo });
  await espelhar({ tipo: "fim", userId, sessaoId, status, motivo }, await prazoDoEspelho());
  if (status !== "parada") {
    await events.emit(status === "pausada" ? EVENTO.pausada : EVENTO.encerrada, { sessaoId, objetivo: s.objetivo, status, motivo, passos: s.passosUsados }, { userId });
  }
  return s;
}

export async function pausarSessao(userId: string, sessaoId: string, motivo: string) {
  return terminarSessao(userId, sessaoId, "pausada", motivo);
}

export async function encerrarSessao(userId: string, sessaoId: string, motivo: string) {
  return terminarSessao(userId, sessaoId, "encerrada", motivo);
}

/**
 * Cria a sessão ATIVA do envelope que o dono aprovou. Encerra a anterior
 * (ampliar é aprovar um envelope novo, e um envelope novo substitui o velho).
 */
export async function abrirSessao(userId: string, env: EnvelopeAprovado, acaoId?: string | null): Promise<ControleSessao> {
  const anterior = await sessaoAtual(userId, true);
  if (anterior) await encerrarSessao(userId, anterior.id, "substituída por um envelope novo");
  const agora = new Date();
  const [s] = await db
    .insert(controleSessao)
    .values({
      userId,
      alvo: env.alvo,
      objetivo: env.objetivo.slice(0, 300),
      pedidoOriginal: env.pedidoOriginal.slice(0, 2000),
      pedidoLiteral: env.pedidoLiteral,
      apps: env.apps,
      sites: env.sites,
      tetoPassos: env.tetoPassos,
      tetoMinutos: env.tetoMinutos,
      expiraEm: new Date(agora.getTime() + env.tetoMinutos * 60_000),
      status: "ativa",
      canal: env.canal,
      maquina: env.maquina ?? maquinaLocal(),
      acaoId: acaoId ?? null,
    })
    .returning();
  log.info("controle.sessao_iniciada", { userId, sessaoId: s!.id, alvo: env.alvo, tetoPassos: env.tetoPassos, tetoMinutos: env.tetoMinutos });
  await espelhar({ tipo: "envelope", userId, envelope: envelopeEspelhado(s!) }, await prazoDoEspelho());
  await events.emit(EVENTO.iniciada, { sessaoId: s!.id, objetivo: s!.objetivo, alvo: s!.alvo, apps: s!.apps, sites: s!.sites, tetoPassos: s!.tetoPassos, tetoMinutos: s!.tetoMinutos, canal: s!.canal }, { userId });
  return s!;
}

/**
 * Para o `authorize` das tools `escrita` de computador e navegador: sessão
 * ativa que cubra o tipo, dentro do tempo e do teto, com o app ou o site no
 * envelope. Devolve a frase de recusa (que diz como abrir uma) ou null.
 * Tempo ou teto estourado pausa a sessão aqui mesmo, para o espelho saber.
 */
export async function autorizarNaSessao(ctx: Pick<ToolContext, "userId">, alvo: AlvoDaAcao): Promise<string | null> {
  const s = await sessaoAtual(ctx.userId);
  const c = conferirSessao(s ? { ...s, alvo: s.alvo as AlvoDaSessao } : null, alvo);
  if (c.ok) return null;
  if (c.pausar && s) await pausarSessao(ctx.userId, s.id, c.pausar);
  return c.motivo;
}

/**
 * Conta UM passo da sessão, de forma atômica e só se ainda couber: duas ações
 * em paralelo não passam juntas do teto. Sem vaga, devolve null (e quem chama
 * pausa a sessão).
 */
export async function contarPasso(userId: string, sessaoId: string): Promise<ControleSessao | null> {
  const [s] = await db
    .update(controleSessao)
    .set({ passosUsados: sql`${controleSessao.passosUsados} + 1`, atualizadaEm: new Date() })
    .where(
      and(
        eq(controleSessao.id, sessaoId),
        eq(controleSessao.userId, userId),
        eq(controleSessao.status, "ativa"),
        lt(controleSessao.passosUsados, controleSessao.tetoPassos),
        sql`${controleSessao.expiraEm} > now()`,
      ),
    )
    .returning();
  return s ?? null;
}

/** Veto do crítico: soma um e devolve quantos seguidos já são. Alinhado zera. */
export async function registrarVeredito(userId: string, sessaoId: string, alinhado: boolean): Promise<number> {
  const [s] = await db
    .update(controleSessao)
    .set({ vetosSeguidos: alinhado ? 0 : sql`${controleSessao.vetosSeguidos} + 1`, atualizadaEm: new Date() })
    .where(and(eq(controleSessao.id, sessaoId), eq(controleSessao.userId, userId)))
    .returning({ vetos: controleSessao.vetosSeguidos });
  return s?.vetos ?? 0;
}

/**
 * Laço do processo vivo: sessão ativa cujo tempo passou vira pausada, para
 * as mãos tirarem a borda mesmo sem nenhuma ação tentando agir.
 */
export async function pausarSessoesVencidas(): Promise<number> {
  const vencidas = await db
    .select({ id: controleSessao.id, userId: controleSessao.userId })
    .from(controleSessao)
    .where(and(eq(controleSessao.status, "ativa"), lte(controleSessao.expiraEm, new Date())));
  let n = 0;
  for (const v of vencidas) if (await pausarSessao(v.userId, v.id, "tempo")) n++;
  return n;
}

/**
 * Sessões terminadas há mais que `dias` somem (os passos vão junto, cascade).
 * A PAUSADA também: ela fica com `terminada_em` nulo (pausar não termina, só
 * um envelope novo ou o "para" a tiram dali) e nunca era apagada (M9 da
 * auditoria). Para ela, vale a última mudança (`atualizada_em`), que é quando
 * pausou. A ativa nunca sai por aqui: a que venceu o tempo vira pausada antes.
 */
export async function purgarSessoes(dias: number): Promise<number> {
  if (!dias || dias <= 0) return 0;
  const corte = new Date(Date.now() - dias * 86_400_000);
  const r = await db
    .delete(controleSessao)
    .where(
      or(
        and(isNotNull(controleSessao.terminadaEm), lt(controleSessao.terminadaEm, corte)),
        and(eq(controleSessao.status, "pausada"), lt(controleSessao.atualizadaEm, corte)),
      ),
    )
    .returning({ id: controleSessao.id });
  return r.length;
}

export async function listarSessoes(userId: string, limite = 30): Promise<ControleSessao[]> {
  return db.select().from(controleSessao).where(eq(controleSessao.userId, userId)).orderBy(desc(controleSessao.criadaEm)).limit(limite);
}

export async function sessaoPorId(userId: string, id: string): Promise<ControleSessao | null> {
  const [s] = await db.select().from(controleSessao).where(and(eq(controleSessao.id, id), eq(controleSessao.userId, userId))).limit(1);
  return s ?? null;
}

/** Tipo de alvo de uma tool sensível + a sessão que cobre: o que a guarda precisa. */
export async function sessaoParaTipo(userId: string, tipo: TipoDeAlvo): Promise<ControleSessao | null> {
  const s = await sessaoAtual(userId);
  return s && (s.alvo === "ambos" || s.alvo === tipo) ? s : null;
}
