import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { waContato, waMensagem, type WaContato, type WaMensagem } from "@orbita/db/whatsapp-schema";
import type { TipoMensagem } from "./traduzir";
import { normalizarFrase } from "./regras";

/**
 * Leitura e escrita do WhatsApp no banco. Toda consulta filtra por `userId`.
 */

// ── contatos ──

export async function garantirContato(userId: string, jid: string, dados: { nome?: string | null; grupo: boolean; escreveu?: boolean; em?: Date }): Promise<WaContato> {
  const [c] = await db
    .insert(waContato)
    .values({ userId, jid, nome: dados.nome ?? null, grupo: dados.grupo, escreveuAlgumaVez: Boolean(dados.escreveu), ultimaMensagemEm: dados.em ?? null })
    .onConflictDoUpdate({
      target: [waContato.userId, waContato.jid],
      set: {
        // o nome do WhatsApp só é gravado quando vem; um evento sem nome não apaga o que havia
        ...(dados.nome ? { nome: dados.nome } : {}),
        ...(dados.escreveu ? { escreveuAlgumaVez: true } : {}),
        // ISO + cast, NUNCA a Date crua: dentro do sql`` ela vira o toString() do
        // JavaScript e o Postgres recusa (CLAUDE.md §9; o smoke pegou isto aqui)
        ...(dados.em ? { ultimaMensagemEm: sql`greatest(${waContato.ultimaMensagemEm}, ${dados.em.toISOString()}::timestamp)` } : {}),
      },
    })
    .returning();
  return c;
}

export async function contatoPorJid(userId: string, jid: string): Promise<WaContato | null> {
  const [c] = await db.select().from(waContato).where(and(eq(waContato.userId, userId), eq(waContato.jid, jid))).limit(1);
  return c ?? null;
}

export async function contatoPorId(userId: string, id: string): Promise<WaContato | null> {
  const [c] = await db.select().from(waContato).where(and(eq(waContato.userId, userId), eq(waContato.id, id))).limit(1);
  return c ?? null;
}

export async function listarContatos(userId: string, limite = 200): Promise<WaContato[]> {
  return db.select().from(waContato).where(eq(waContato.userId, userId)).orderBy(desc(waContato.ultimaMensagemEm)).limit(limite);
}

export async function atualizarContato(userId: string, id: string, patch: { apelido?: string | null; modo?: "aprovar" | "automatico"; pausadoAte?: Date | null }): Promise<WaContato | null> {
  const [c] = await db.update(waContato).set(patch).where(and(eq(waContato.userId, userId), eq(waContato.id, id))).returning();
  return c ?? null;
}

/**
 * Quem é "a Maria"? PURA sobre a lista: nome exato ou apelido exato vence;
 * senão, quem CONTÉM o termo. Mais de um candidato volta como lista, e quem
 * chama pergunta: responder para a Maria errada não se desfaz.
 */
export function casarContato<T extends { nome: string | null; apelido: string | null; jid: string }>(contatos: readonly T[], termo: string): T[] {
  const t = normalizarFrase(termo);
  if (!t) return [];
  const digitos = termo.replace(/\D/g, "");
  if (digitos.length >= 8) return contatos.filter((c) => c.jid.startsWith(digitos) || c.jid.split("@")[0].endsWith(digitos));
  // Só o APELIDO (dado pelo dono) vence sozinho. O nome do WhatsApp é o
  // contato quem escolhe: um desconhecido chamado exatamente "Maria" não pode
  // ganhar da "Maria Souza" de verdade. Por nome, todo mundo que casa entra na
  // lista, e mais de um é pergunta.
  const apelidoExato = contatos.filter((c) => c.apelido && normalizarFrase(c.apelido) === t);
  if (apelidoExato.length) return apelidoExato;
  const nomes = (c: T) => [c.apelido, c.nome].filter((x): x is string => Boolean(x)).map(normalizarFrase);
  return contatos.filter((c) => nomes(c).some((n) => n === t || n.split(" ").includes(t) || n.includes(t)));
}

// ── mensagens ──

export type NovaMensagem = Omit<typeof waMensagem.$inferInsert, "id" | "criadoEm">;

/** Grava; devolve nulo se a mensagem já existia (reentrega do webhook). */
export async function inserirMensagem(m: NovaMensagem): Promise<WaMensagem | null> {
  const [r] = await db.insert(waMensagem).values(m).onConflictDoNothing({ target: [waMensagem.userId, waMensagem.externalId] }).returning();
  return r ?? null;
}

export async function mensagemPorExternalId(userId: string, externalId: string): Promise<WaMensagem | null> {
  const [m] = await db.select().from(waMensagem).where(and(eq(waMensagem.userId, userId), eq(waMensagem.externalId, externalId))).limit(1);
  return m ?? null;
}

/** Devolve quantas linhas mudaram: zero é "a mensagem ainda não chegou". */
export async function atualizarMensagem(userId: string, externalId: string, patch: Partial<Pick<WaMensagem, "texto" | "editada" | "apagada" | "reacao" | "transcricao" | "descricaoImagem" | "midiaCaminho" | "midiaSha256" | "midiaMime">>): Promise<number> {
  const r = await db.update(waMensagem).set(patch).where(and(eq(waMensagem.userId, userId), eq(waMensagem.externalId, externalId))).returning({ id: waMensagem.id });
  return r.length;
}

export async function atualizarMensagemPorId(userId: string, id: string, patch: Partial<Pick<WaMensagem, "transcricao" | "descricaoImagem" | "midiaCaminho" | "midiaSha256" | "midiaMime" | "externalId">>): Promise<void> {
  await db.update(waMensagem).set(patch).where(and(eq(waMensagem.userId, userId), eq(waMensagem.id, id)));
}

// ── eco: o que a Órbita mandou voltando pelo webhook ──

/**
 * Hash do conteúdo de uma saída. Texto é normalizado (o WhatsApp não mexe no
 * texto, mas espaço sobrando no fim não pode fazer a Órbita tomar a própria
 * resposta por mensagem nova do dono e responder a si mesma).
 */
export function hashDoConteudo(tipo: TipoMensagem, texto: string | null | undefined): string {
  return createHash("sha256").update(`${tipo}:${(texto ?? "").trim()}`).digest("hex");
}

/** Linha da saída, gravada ANTES de mandar: é o que torna o eco reconhecível. */
export async function registrarSaida(userId: string, contatoId: string, chatJid: string, tipo: TipoMensagem, texto: string | null, automatica: boolean, extra: { midiaCaminho?: string | null; midiaMime?: string | null; respondeA?: string | null } = {}): Promise<string> {
  const [r] = await db
    .insert(waMensagem)
    .values({ userId, contatoId, chatJid, deMim: true, tipo, texto, enviadaPelaOrbita: true, automatica, conteudoHash: hashDoConteudo(tipo, texto), em: new Date(), ...extra })
    .returning({ id: waMensagem.id });
  return r.id;
}

export async function confirmarSaida(userId: string, id: string, externalId: string): Promise<void> {
  // o eco pode ter chegado antes e já gravado o id nesta mesma linha: tudo bem
  await db.update(waMensagem).set({ externalId }).where(and(eq(waMensagem.userId, userId), eq(waMensagem.id, id), isNull(waMensagem.externalId)));
}

export async function desfazerSaida(userId: string, id: string): Promise<void> {
  await db.delete(waMensagem).where(and(eq(waMensagem.userId, userId), eq(waMensagem.id, id), isNull(waMensagem.externalId)));
}

/**
 * Esta mensagem `deMim` que chegou é a volta de uma saída da Órbita? Casa pelo
 * hash com uma saída ainda sem id dos últimos `janelaMs`, no mesmo chat, e
 * grava o id nela. Devolve true se era eco.
 */
export async function casarEco(userId: string, chatJid: string, tipo: TipoMensagem, texto: string | null, externalId: string, janelaMs = 120_000): Promise<boolean> {
  const [pendente] = await db
    .select({ id: waMensagem.id })
    .from(waMensagem)
    .where(
      and(
        eq(waMensagem.userId, userId),
        eq(waMensagem.chatJid, chatJid),
        eq(waMensagem.enviadaPelaOrbita, true),
        isNull(waMensagem.externalId),
        eq(waMensagem.conteudoHash, hashDoConteudo(tipo, texto)),
        gte(waMensagem.em, new Date(Date.now() - janelaMs)),
      ),
    )
    .orderBy(asc(waMensagem.em))
    .limit(1);
  if (!pendente) return false;
  await db.update(waMensagem).set({ externalId }).where(eq(waMensagem.id, pendente.id));
  return true;
}

// ── leitura ──

export async function mensagensDoChat(userId: string, chatJid: string, limite: number, antesDe?: Date): Promise<WaMensagem[]> {
  const rows = await db
    .select()
    .from(waMensagem)
    .where(and(eq(waMensagem.userId, userId), eq(waMensagem.chatJid, chatJid), antesDe ? lt(waMensagem.em, antesDe) : undefined))
    .orderBy(desc(waMensagem.em))
    .limit(limite);
  return rows.reverse();
}

export async function marcarLidas(userId: string, chatJid: string): Promise<void> {
  await db.update(waMensagem).set({ lidaEm: new Date() }).where(and(eq(waMensagem.userId, userId), eq(waMensagem.chatJid, chatJid), eq(waMensagem.deMim, false), isNull(waMensagem.lidaEm)));
}

export interface ResumoDeConversa {
  contato: WaContato;
  naoLidas: number;
  ultima: WaMensagem | null;
}

/** Conversas com movimento recente, com a contagem de não lidas pela Órbita. */
export async function conversasRecentes(userId: string, limite: number, desde?: Date, excluirJid?: string | null): Promise<ResumoDeConversa[]> {
  const contatos = await db
    .select()
    .from(waContato)
    .where(and(eq(waContato.userId, userId), desde ? gte(waContato.ultimaMensagemEm, desde) : undefined))
    .orderBy(desc(waContato.ultimaMensagemEm))
    .limit(limite + 1);
  const out: ResumoDeConversa[] = [];
  for (const contato of contatos) {
    if (contato.jid === excluirJid || !contato.ultimaMensagemEm) continue;
    const [[ultima], [{ n } = { n: 0 }]] = await Promise.all([
      db.select().from(waMensagem).where(and(eq(waMensagem.userId, userId), eq(waMensagem.contatoId, contato.id))).orderBy(desc(waMensagem.em)).limit(1),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(waMensagem)
        .where(and(eq(waMensagem.userId, userId), eq(waMensagem.contatoId, contato.id), eq(waMensagem.deMim, false), isNull(waMensagem.lidaEm))),
    ]);
    out.push({ contato, naoLidas: Number(n), ultima: ultima ?? null });
    if (out.length >= limite) break;
  }
  return out;
}

/** Busca em texto e transcrição. ILIKE na v1: poucas mensagens de uma pessoa só. */
export async function buscarMensagens(userId: string, termo: string, limite: number, chatJid?: string | null): Promise<WaMensagem[]> {
  const t = `%${termo.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  return db
    .select()
    .from(waMensagem)
    .where(and(eq(waMensagem.userId, userId), chatJid ? eq(waMensagem.chatJid, chatJid) : undefined, or(ilike(waMensagem.texto, t), ilike(waMensagem.transcricao, t), ilike(waMensagem.descricaoImagem, t))))
    .orderBy(desc(waMensagem.em))
    .limit(limite);
}

export async function mensagemPorId(userId: string, id: string): Promise<WaMensagem | null> {
  const [m] = await db.select().from(waMensagem).where(and(eq(waMensagem.userId, userId), eq(waMensagem.id, id))).limit(1);
  return m ?? null;
}

// ── contas para as travas ──

export async function enviadasDesde(userId: string, desde: Date, contatoId?: string, soAutomaticas = false): Promise<number> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(waMensagem)
    .where(
      and(
        eq(waMensagem.userId, userId),
        eq(waMensagem.enviadaPelaOrbita, true),
        gte(waMensagem.em, desde),
        contatoId ? eq(waMensagem.contatoId, contatoId) : undefined,
        soAutomaticas ? eq(waMensagem.automatica, true) : undefined,
      ),
    );
  return Number(n);
}

// ── retenção ──

const LOTE = 500;

/**
 * Apaga mensagens mais velhas que `dias`, em LOTES (ligar a retenção depois de
 * meses de acúmulo não pode virar uma consulta com dezenas de milhares de
 * parâmetros). Devolve os caminhos de mídia que ficaram órfãos na hora.
 */
export async function purgarMensagens(dias: number): Promise<string[]> {
  if (dias <= 0) return [];
  const corte = new Date(Date.now() - dias * 86_400_000);
  const caminhos = new Set<string>();
  for (;;) {
    const ids = (await db.select({ id: waMensagem.id }).from(waMensagem).where(lt(waMensagem.em, corte)).limit(LOTE)).map((r) => r.id);
    if (!ids.length) break;
    for (const r of await db.delete(waMensagem).where(inArray(waMensagem.id, ids)).returning({ caminho: waMensagem.midiaCaminho })) if (r.caminho) caminhos.add(r.caminho);
    if (ids.length < LOTE) break;
  }
  return caminhosSemUso([...caminhos]);
}

/**
 * Dos caminhos, os que nenhuma mensagem usa AGORA. A mídia é deduplicada por
 * sha256: o mesmo meme pode ter chegado de novo entre apagar a mensagem velha e
 * apagar o arquivo, e quem apaga chama isto de novo logo antes do `rm`.
 */
export async function caminhosSemUso(caminhos: readonly string[]): Promise<string[]> {
  const livres: string[] = [];
  for (let i = 0; i < caminhos.length; i += LOTE) {
    const lote = caminhos.slice(i, i + LOTE);
    const usados = new Set((await db.select({ caminho: waMensagem.midiaCaminho }).from(waMensagem).where(inArray(waMensagem.midiaCaminho, lote))).map((r) => r.caminho));
    livres.push(...lote.filter((c) => !usados.has(c)));
  }
  return livres;
}

/** O que saiu sozinho, para a tela mostrar (W7: tudo que a Órbita mandou sem aprovação fica visível). */
export async function automaticasRecentes(userId: string, limite: number): Promise<WaMensagem[]> {
  return db.select().from(waMensagem).where(and(eq(waMensagem.userId, userId), eq(waMensagem.automatica, true))).orderBy(desc(waMensagem.em)).limit(limite);
}
