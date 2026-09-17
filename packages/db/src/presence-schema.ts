import { pgTable, text, timestamp, uuid, real, unique, index } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { person, room } from "./home-schema";

/**
 * PRESENÇA (Onda 10, decisão 9.3 de 17/09): quem está em qual cômodo AGORA.
 * Atualizada só quando uma câmera com identificação ligada vê alguém, nunca por
 * varredura contínua: é barata (vetor de rosto, sem VLM) e é o que permite
 * "apaga a luz de onde eu estou" e a permissão por cômodo em tempo real.
 *
 * Uma linha por pessoa (o cômodo atual). O histórico de quem esteve onde fica
 * na trilha de identidade, que é auditável e apagável junto com a pessoa.
 */
export const personPresence = pgTable(
  "person_presence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => room.id, { onDelete: "set null" }),
    /** camera | voz (a Onda 12 liga dispositivo e cômodo) */
    source: text("source").notNull(),
    confidence: real("confidence"),
    seenAt: timestamp("seen_at").defaultNow().notNull(),
  },
  (t) => [unique("person_presence_person").on(t.userId, t.personId), index("person_presence_seen_idx").on(t.seenAt)],
);

export type PersonPresence = typeof personPresence.$inferSelect;
