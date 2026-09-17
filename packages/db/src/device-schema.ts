import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { room } from "./home-schema";

/**
 * DISPOSITIVO e seu CÔMODO (B5.3 e B5.4, Onda 12). "Apaga a luz daqui" exige
 * saber onde é "aqui": o navegador (ou um satélite de voz, quando houver
 * hardware) se registra uma vez, ganha um id, e manda esse id junto do pedido.
 *
 * Não é credencial: a sessão continua sendo a do Better Auth. O id do
 * dispositivo só diz DE ONDE veio o pedido, e só vale para a conta dona.
 */
export const device = pgTable(
  "device",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** navegador | satelite | celular — só rótulo, não muda comportamento */
    kind: text("kind").notNull().default("navegador"),
    roomId: uuid("room_id").references(() => room.id, { onDelete: "set null" }),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("device_user_idx").on(t.userId)],
);

export type Device = typeof device.$inferSelect;
