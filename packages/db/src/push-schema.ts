import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PushSubscription = typeof pushSubscription.$inferSelect;
