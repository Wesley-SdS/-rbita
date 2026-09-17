import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { device } from "./device-schema";

/**
 * Inscrições Web Push do usuário (um registro por navegador/dispositivo).
 * A chave é o endpoint do push service; guardamos as chaves p256dh/auth
 * necessárias para cifrar a mensagem (protocolo Web Push).
 */
export const pushSubscription = pgTable("push_subscription", {
  endpoint: text("endpoint").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  /** dispositivo (e portanto cômodo) deste navegador, quando o dono o cadastrou (Onda 12) */
  deviceId: uuid("device_id").references(() => device.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PushSubscription = typeof pushSubscription.$inferSelect;
