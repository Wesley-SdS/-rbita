import { integer, pgTable, text, timestamp, uuid, unique, primaryKey } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Onda 2 (reuniões): dedup do aviso de reunião próxima e cursor do watch de
 * e-mail. Sem push do Google (exige URL pública, que a instância ainda não
 * tem — B9.1), o processo persistente faz *polling* via cron; estas tabelas
 * evitam avisar duas vezes pelo mesmo evento/e-mail a cada volta do laço.
 */
export const meetingReminder = pgTable(
  "meeting_reminder",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    calendarEventId: text("calendar_event_id").notNull(),
    remindedAt: timestamp("reminded_at").defaultNow().notNull(),
  },
  (t) => [unique("meeting_reminder_user_event").on(t.userId, t.calendarEventId)],
);

/** Cursor do watch de Gmail: só e-mails mais novos que este instante viram evento. */
export const gmailWatchState = pgTable("gmail_watch_state", {
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  lastSeenAt: timestamp("last_seen_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId] })]);

export type MeetingReminder = typeof meetingReminder.$inferSelect;
export type GmailWatchState = typeof gmailWatchState.$inferSelect;

/**
 * Transcrição de reunião ONLINE (Meet, Teams, Zoom) que a Órbita já puxou.
 * O laço pergunta a cada volta "o que tem de novo?", e esta tabela é a memória
 * de que aquela transcrição já virou resumo: sem ela, cada volta resumiria a
 * mesma reunião de novo (e gastaria o modelo de novo).
 */
export const reuniaoImportada = pgTable(
  "reuniao_importada",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "meet" · "teams" · "zoom" */
    fonte: text("fonte").notNull(),
    /** id da transcrição no provedor */
    externalId: text("external_id").notNull(),
    titulo: text("titulo").notNull(),
    inicio: timestamp("inicio"),
    /**
     * "resumindo" (foi para a fila) · "curta" (pouco texto, nada a resumir) ·
     * "falhou" (baixar ou resumir deu erro: tenta de novo até o teto, com espera)
     * · "desistiu" (passou do teto: não gasta mais API nem modelo com ela)
     */
    situacao: text("situacao").notNull(),
    jobId: text("job_id"),
    tentativas: integer("tentativas").notNull().default(0),
    ultimoErro: text("ultimo_erro"),
    proximaTentativa: timestamp("proxima_tentativa"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [unique("reuniao_importada_user_fonte_ext").on(t.userId, t.fonte, t.externalId)],
);

export type ReuniaoImportada = typeof reuniaoImportada.$inferSelect;
