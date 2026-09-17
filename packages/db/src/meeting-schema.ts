import { pgTable, text, timestamp, uuid, unique, primaryKey } from "drizzle-orm/pg-core";
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
