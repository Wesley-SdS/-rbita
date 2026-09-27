import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * WhatsApp PESSOAL do dono, pela ponte local GOWA (PRD-WHATSAPP.md).
 *
 * A Cloud API da Meta continua em `channels-schema.ts` (`whatsapp_connection`):
 * são dois provedores, e o dono escolhe. Aqui mora o que a ponte precisa e que
 * a Cloud API nunca teve: a sessão pareada, as conversas recebidas e a mídia.
 *
 * Tudo cascateia a partir do `user`: apagar a conta apaga as mensagens de
 * terceiros que a Órbita guardou, sem passo à parte (account/data.test.ts).
 */

/** A sessão pareada. Uma por dono na v1; toda consulta já filtra por `deviceId`. */
export const waSessao = pgTable(
  "wa_sessao",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** o `device_id` registrado no GOWA; volta no webhook como `session_id` */
    deviceId: text("device_id").notNull(),
    /** HMAC do webhook, por sessão (nunca um segredo global do .env) */
    webhookSegredoEnc: text("webhook_segredo_enc").notNull(),
    /** o JID do número pareado: é por ele que a conversa "Eu" é reconhecida */
    jid: text("jid"),
    status: text("status", { enum: ["desconectado", "pareando", "conectado", "banido"] }).notNull().default("desconectado"),
    pareadoEm: timestamp("pareado_em"),
    /** reconexões contadas pela saúde (só a partir da segunda conexão) */
    reconexoes: integer("reconexoes").notNull().default(0),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
    atualizadoEm: timestamp("atualizado_em").defaultNow().notNull(),
  },
  (t) => [unique("wa_sessao_user").on(t.userId), unique("wa_sessao_device").on(t.deviceId)],
);

/**
 * Um chat: pessoa ou grupo. O `modo` é a decisão do dono sobre a Órbita
 * responder sozinha (W7), e nasce em `aprovar` para todo mundo.
 */
export const waContato = pgTable(
  "wa_contato",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jid: text("jid").notNull(),
    /** o nome que o WhatsApp informa (push name) */
    nome: text("nome"),
    /** como o dono chama essa pessoa ("mãe"); vence o `nome` na busca */
    apelido: text("apelido"),
    grupo: boolean("grupo").notNull().default(false),
    modo: text("modo", { enum: ["aprovar", "automatico"] }).notNull().default("aprovar"),
    /** o automático fica parado até aqui (o dono assumiu, estourou o teto, laço) */
    pausadoAte: timestamp("pausado_ate"),
    /** o contato já escreveu alguma vez: sem isso, envio é abordagem fria (antibanimento) */
    escreveuAlgumaVez: boolean("escreveu_alguma_vez").notNull().default(false),
    ultimaMensagemEm: timestamp("ultima_mensagem_em"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [unique("wa_contato_user_jid").on(t.userId, t.jid), index("wa_contato_user_ultima_idx").on(t.userId, t.ultimaMensagemEm)],
);

export const waMensagem = pgTable(
  "wa_mensagem",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contatoId: uuid("contato_id")
      .notNull()
      .references(() => waContato.id, { onDelete: "cascade" }),
    chatJid: text("chat_jid").notNull(),
    /** quem escreveu (num grupo, difere do chat) */
    autorJid: text("autor_jid"),
    autorNome: text("autor_nome"),
    /** id da mensagem no WhatsApp; nulo só enquanto uma saída da Órbita não voltou */
    externalId: text("external_id"),
    deMim: boolean("de_mim").notNull().default(false),
    tipo: text("tipo", { enum: ["texto", "imagem", "audio", "video", "documento", "figurinha", "localizacao", "contato"] }).notNull(),
    texto: text("texto"),
    transcricao: text("transcricao"),
    descricaoImagem: text("descricao_imagem"),
    midiaCaminho: text("midia_caminho"),
    midiaSha256: text("midia_sha256"),
    midiaMime: text("midia_mime"),
    respondeA: text("responde_a"),
    reacao: text("reacao"),
    apagada: boolean("apagada").notNull().default(false),
    editada: boolean("editada").notNull().default(false),
    /** saiu pela Órbita (aprovada ou automática); o resto que é `deMim` o dono digitou */
    enviadaPelaOrbita: boolean("enviada_pela_orbita").notNull().default(false),
    automatica: boolean("automatica").notNull().default(false),
    /** hash do conteúdo que a Órbita mandou: é como o eco do webhook é reconhecido */
    conteudoHash: text("conteudo_hash"),
    lidaEm: timestamp("lida_em"),
    /**
     * Quando a mensagem já foi avisada (evento) e entregue ao roteador. Sem
     * esta marca, uma queda entre gravar e rotear fazia a nova tentativa ver a
     * linha como "reentrega" e parar: o pedido do dono sumia em silêncio.
     */
    roteadaEm: timestamp("roteada_em"),
    em: timestamp("em").notNull(),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [
    unique("wa_mensagem_user_external").on(t.userId, t.externalId),
    index("wa_mensagem_chat_em_idx").on(t.userId, t.chatJid, t.em),
    index("wa_mensagem_user_em_idx").on(t.userId, t.em),
  ],
);

/**
 * "Gravar antes de processar": o webhook só grava aqui e responde 200. Quem
 * processa é a fila. O GOWA reenvia se o 200 demora, e a chave única faz a
 * reentrega virar nada.
 */
export const waEventoBruto = pgTable(
  "wa_evento_bruto",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    tipo: text("tipo").notNull(),
    externalId: text("external_id").notNull(),
    corpo: jsonb("corpo").notNull(),
    recebidoEm: timestamp("recebido_em").defaultNow().notNull(),
    processadoEm: timestamp("processado_em"),
    falhas: integer("falhas").notNull().default(0),
    ultimoErro: text("ultimo_erro"),
  },
  (t) => [
    unique("wa_evento_bruto_chave").on(t.deviceId, t.tipo, t.externalId),
    index("wa_evento_bruto_recebido_idx").on(t.recebidoEm),
    // o laço de pendentes roda a cada 15 s: sem o parcial, ele percorreria a
    // tabela retida inteira atrás das poucas linhas ainda não processadas
    index("wa_evento_bruto_pendente_idx").on(t.recebidoEm).where(sql`${t.processadoEm} is null`),
  ],
);

export type WaSessao = typeof waSessao.$inferSelect;
export type WaContato = typeof waContato.$inferSelect;
export type WaMensagem = typeof waMensagem.$inferSelect;
export type WaEventoBruto = typeof waEventoBruto.$inferSelect;
