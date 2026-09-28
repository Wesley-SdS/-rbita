import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@orbita/db";
import { tgBot, tgContato, tgConvite, tgMensagem, type TgBot, type TgContato, type TgMensagem } from "@orbita/db/telegram-schema";
import { decryptSecret, encryptSecret } from "../crypto";
import type { MensagemTraduzida } from "./traduzir";

/**
 * O banco do Telegram num lugar só (bot, quem fala com ele, convites e
 * mensagens). Toda consulta filtra pelo dono.
 */

// ── o bot ──

export async function botDe(userId: string): Promise<TgBot | null> {
  const [b] = await db.select().from(tgBot).where(eq(tgBot.userId, userId)).limit(1);
  return b ?? null;
}

export async function todosOsBots(): Promise<TgBot[]> {
  return db.select().from(tgBot);
}

/** O token em claro, só para chamar a API. Nunca sai daqui para log ou tela. */
export function tokenDo(bot: TgBot): string {
  return decryptSecret(bot.tokenEnc);
}

export async function salvarBot(userId: string, token: string, info: { id: number; username: string }): Promise<void> {
  const valores = { tokenEnc: encryptSecret(token), botId: String(info.id), username: info.username, ultimoErro: null };
  await db
    .insert(tgBot)
    .values({ userId, ...valores, proximoUpdate: 0 })
    // trocar de bot recomeça o cursor: os updates são de cada bot
    .onConflictDoUpdate({ target: tgBot.userId, set: { ...valores, proximoUpdate: 0 } });
}

export async function apagarBot(userId: string): Promise<void> {
  await db.delete(tgBot).where(eq(tgBot.userId, userId));
}

export async function avancarCursor(userId: string, proximo: number): Promise<void> {
  await db.update(tgBot).set({ proximoUpdate: proximo, ultimoContatoEm: new Date(), ultimoErro: null }).where(eq(tgBot.userId, userId));
}

export async function anotarErro(userId: string, erro: string): Promise<void> {
  await db.update(tgBot).set({ ultimoErro: erro.slice(0, 300) }).where(eq(tgBot.userId, userId));
}

export async function marcarBriefing(userId: string, dia: string): Promise<void> {
  await db.update(tgBot).set({ ultimoBriefing: dia }).where(eq(tgBot.userId, userId));
}

// ── quem fala com o bot ──

export async function garantirContato(userId: string, m: Pick<MensagemTraduzida, "telegramId" | "nome" | "username">): Promise<TgContato> {
  const [c] = await db
    .insert(tgContato)
    .values({ userId, telegramId: m.telegramId, nome: m.nome, username: m.username })
    // o nome pode mudar no Telegram; o papel e o vínculo, só pelo dono
    .onConflictDoUpdate({ target: [tgContato.userId, tgContato.telegramId], set: { nome: m.nome, username: m.username } })
    .returning();
  return c;
}

export async function contatoPorId(userId: string, id: string): Promise<TgContato | null> {
  const [c] = await db.select().from(tgContato).where(and(eq(tgContato.userId, userId), eq(tgContato.id, id))).limit(1);
  return c ?? null;
}

export async function listarContatos(userId: string): Promise<TgContato[]> {
  return db.select().from(tgContato).where(eq(tgContato.userId, userId)).orderBy(asc(tgContato.criadoEm));
}

export async function donoNoTelegram(userId: string): Promise<TgContato | null> {
  const [c] = await db.select().from(tgContato).where(and(eq(tgContato.userId, userId), eq(tgContato.papel, "dono"))).limit(1);
  return c ?? null;
}

export async function atualizarContato(userId: string, id: string, patch: { papel?: TgContato["papel"]; personId?: string | null }): Promise<TgContato | null> {
  const [c] = await db.update(tgContato).set(patch).where(and(eq(tgContato.userId, userId), eq(tgContato.id, id))).returning();
  return c ?? null;
}

export async function apagarContato(userId: string, id: string): Promise<boolean> {
  const r = await db.delete(tgContato).where(and(eq(tgContato.userId, userId), eq(tgContato.id, id))).returning({ id: tgContato.id });
  return r.length > 0;
}

export async function marcarAvisado(id: string): Promise<void> {
  await db.update(tgContato).set({ avisadoEm: new Date() }).where(eq(tgContato.id, id));
}

// ── convites ──

const hash = (codigo: string) => createHash("sha256").update(codigo).digest("hex");

/** Código de uso único para o link t.me/<bot>?start=<código>. Guarda só o hash. */
export async function criarConvite(userId: string, papel: "dono" | "pessoa", personId: string | null, validadeMin: number): Promise<{ codigo: string; expiraEm: Date }> {
  const codigo = randomBytes(18).toString("base64url");
  const expiraEm = new Date(Date.now() + validadeMin * 60_000);
  await db.insert(tgConvite).values({ userId, codigoHash: hash(codigo), papel, personId, expiraEm });
  return { codigo, expiraEm };
}

/**
 * Usa o convite, atômico: vencido, usado ou de outro dono não serve, e dois
 * cliques no mesmo link não vinculam duas pessoas.
 */
export async function usarConvite(userId: string, codigo: string): Promise<{ papel: "dono" | "pessoa"; personId: string | null } | null> {
  const [c] = await db
    .update(tgConvite)
    .set({ usadoEm: new Date() })
    .where(and(eq(tgConvite.userId, userId), eq(tgConvite.codigoHash, hash(codigo)), isNull(tgConvite.usadoEm), gt(tgConvite.expiraEm, new Date())))
    .returning({ papel: tgConvite.papel, personId: tgConvite.personId });
  return c ?? null;
}

export async function vincular(userId: string, contatoId: string, papel: "dono" | "pessoa", personId: string | null): Promise<void> {
  // um dono só: vincular outro Telegram como dono desfaz o anterior
  if (papel === "dono") await db.update(tgContato).set({ papel: "desconhecido" }).where(and(eq(tgContato.userId, userId), eq(tgContato.papel, "dono")));
  await db.update(tgContato).set({ papel, personId, vinculadoEm: new Date() }).where(and(eq(tgContato.userId, userId), eq(tgContato.id, contatoId)));
}

// ── mensagens ──

/** Grava; nulo se já existia (o mesmo update entregue de novo). */
export async function inserirMensagem(v: typeof tgMensagem.$inferInsert): Promise<TgMensagem | null> {
  const [m] = await db.insert(tgMensagem).values(v).onConflictDoNothing({ target: [tgMensagem.userId, tgMensagem.chatId, tgMensagem.messageId] }).returning();
  return m ?? null;
}

export async function atualizarMensagem(id: string, patch: Partial<Pick<TgMensagem, "transcricao" | "midiaCaminho" | "midiaMime" | "roteadaEm">>): Promise<void> {
  await db.update(tgMensagem).set(patch).where(eq(tgMensagem.id, id));
}

/** O que foi gravado e ainda não foi entregue a um turno (uma queda entre gravar e rotear). */
export async function naoRoteadas(userId: string, desde: Date): Promise<TgMensagem[]> {
  return db
    .select()
    .from(tgMensagem)
    .where(and(eq(tgMensagem.userId, userId), eq(tgMensagem.doBot, false), isNull(tgMensagem.roteadaEm), gte(tgMensagem.em, desde)))
    .orderBy(asc(tgMensagem.em))
    .limit(50);
}

export async function marcarTurnoPendente(id: string, quando: Date | null): Promise<void> {
  await db.update(tgMensagem).set({ turnoPendenteEm: quando }).where(eq(tgMensagem.id, id));
}

/** Turno começado antes desta subida e não terminado (ver `turnoPendenteEm`). */
export async function turnosInterrompidos(desde: Date, subida: Date): Promise<TgMensagem[]> {
  return db
    .select()
    .from(tgMensagem)
    .where(and(isNotNull(tgMensagem.turnoPendenteEm), lt(tgMensagem.turnoPendenteEm, subida), gte(tgMensagem.em, desde)))
    .orderBy(asc(tgMensagem.em))
    .limit(50);
}

export async function reivindicarTurno(id: string, subida: Date): Promise<boolean> {
  const r = await db.update(tgMensagem).set({ turnoPendenteEm: new Date() }).where(and(eq(tgMensagem.id, id), lt(tgMensagem.turnoPendenteEm, subida))).returning({ id: tgMensagem.id });
  return r.length > 0;
}

/** Quantas mensagens a pessoa mandou na última hora (teto de custo por pessoa). */
export async function recebidasDesde(contatoId: string, desde: Date): Promise<number> {
  const r = await db.select({ id: tgMensagem.id }).from(tgMensagem).where(and(eq(tgMensagem.contatoId, contatoId), eq(tgMensagem.doBot, false), gte(tgMensagem.em, desde)));
  return r.length;
}

export async function mensagensDoContato(userId: string, contatoId: string, limite: number): Promise<TgMensagem[]> {
  const rows = await db.select().from(tgMensagem).where(and(eq(tgMensagem.userId, userId), eq(tgMensagem.contatoId, contatoId))).orderBy(desc(tgMensagem.em)).limit(limite);
  return rows.reverse();
}

export async function registrarSaida(userId: string, contatoId: string, chatId: string, messageId: string, tipo: TgMensagem["tipo"], texto: string | null): Promise<void> {
  await db.insert(tgMensagem).values({ userId, contatoId, chatId, messageId, doBot: true, tipo, texto, em: new Date(), roteadaEm: new Date() }).onConflictDoNothing();
}
