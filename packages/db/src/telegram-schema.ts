import { boolean, index, pgTable, text, timestamp, unique, uuid, bigint } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { person } from "./home-schema";

/**
 * Telegram: o canal DA Órbita (o "número dela" do modelo híbrido, PRD-TELEGRAM).
 *
 * O WhatsApp é o número do dono, onde a Órbita lê e responde COMO ele. Aqui é
 * um bot oficial, onde ela fala como ela mesma: com o dono, com as pessoas da
 * casa vinculadas, avisos e briefing. Bot oficial não é banido, e o laço de
 * leitura (getUpdates) funciona sem endereço público.
 *
 * Tudo cascateia a partir do `user` (apagar a conta apaga o bot e as
 * conversas); o vínculo com uma pessoa some com a pessoa.
 */

/** O bot do dono. O token é segredo: cifrado em repouso, nunca volta para a tela. */
export const tgBot = pgTable("tg_bot", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  tokenEnc: text("token_enc").notNull(),
  botId: text("bot_id").notNull(),
  username: text("username").notNull(),
  /** próximo update a pedir ao Telegram: só avança DEPOIS de gravar o que chegou */
  proximoUpdate: bigint("proximo_update", { mode: "number" }).notNull().default(0),
  ultimoErro: text("ultimo_erro"),
  ultimoContatoEm: timestamp("ultimo_contato_em"),
  /** dia (AAAA-MM-DD, fuso da casa) do último briefing mandado por aqui: um por dia */
  ultimoBriefing: text("ultimo_briefing"),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
});

/**
 * Quem fala com o bot. Qualquer pessoa no mundo pode achar um bot e escrever;
 * só quem entrou por um CONVITE do dono vira `dono` ou `pessoa`. O resto fica
 * registrado como `desconhecido` e não chega ao modelo.
 */
export const tgContato = pgTable(
  "tg_contato",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** id do usuário no Telegram; na conversa privada é também o id do chat */
    telegramId: text("telegram_id").notNull(),
    nome: text("nome"),
    username: text("username"),
    papel: text("papel", { enum: ["dono", "pessoa", "desconhecido", "bloqueado"] }).notNull().default("desconhecido"),
    /** a pessoa da casa (permissão por pessoa e cômodo vale igual à da voz) */
    personId: uuid("person_id").references(() => person.id, { onDelete: "cascade" }),
    vinculadoEm: timestamp("vinculado_em"),
    /** o desconhecido recebe UM recado, não um por mensagem */
    avisadoEm: timestamp("avisado_em"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [unique("tg_contato_user_telegram").on(t.userId, t.telegramId)],
);

/** Convite de vínculo: link t.me/<bot>?start=<código>, uso único, com prazo. Guarda só o hash. */
export const tgConvite = pgTable("tg_convite", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  codigoHash: text("codigo_hash").notNull().unique(),
  papel: text("papel", { enum: ["dono", "pessoa"] }).notNull(),
  personId: uuid("person_id").references(() => person.id, { onDelete: "cascade" }),
  expiraEm: timestamp("expira_em").notNull(),
  usadoEm: timestamp("usado_em"),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
});

/**
 * Mensagens das conversas com o bot. "Gravar antes de processar", como no
 * WhatsApp: o laço grava o que chegou e só então avança o cursor; quem
 * processa lê daqui, e uma queda no meio não perde nada.
 */
export const tgMensagem = pgTable(
  "tg_mensagem",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contatoId: uuid("contato_id")
      .notNull()
      .references(() => tgContato.id, { onDelete: "cascade" }),
    chatId: text("chat_id").notNull(),
    messageId: text("message_id").notNull(),
    /** mandada PELO bot (a Órbita), não recebida */
    doBot: boolean("do_bot").notNull().default(false),
    tipo: text("tipo", { enum: ["texto", "audio", "imagem", "documento", "video", "localizacao", "contato", "figurinha", "outro"] }).notNull(),
    texto: text("texto"),
    transcricao: text("transcricao"),
    /** file_id do Telegram (baixa sob demanda) e a mídia já guardada aqui */
    fileId: text("file_id"),
    midiaCaminho: text("midia_caminho"),
    midiaMime: text("midia_mime"),
    em: timestamp("em").notNull(),
    roteadaEm: timestamp("roteada_em"),
    /** o turno começou e não terminou (mesma razão do `turno_pendente_em` do WhatsApp) */
    turnoPendenteEm: timestamp("turno_pendente_em"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [unique("tg_mensagem_user_chat_msg").on(t.userId, t.chatId, t.messageId), index("tg_mensagem_pendente_idx").on(t.userId, t.roteadaEm)],
);

export type TgBot = typeof tgBot.$inferSelect;
export type TgContato = typeof tgContato.$inferSelect;
export type TgConvite = typeof tgConvite.$inferSelect;
export type TgMensagem = typeof tgMensagem.$inferSelect;
