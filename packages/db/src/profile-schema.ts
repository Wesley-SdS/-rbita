import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Perfil/persona do usuário — personalização persistente da ÓRBITA (PRD §4.5).
 * Um registro por usuário. Injetado no system prompt como chunk de alta
 * prioridade (abaixo só das regras de segurança).
 */
export const profile = pgTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  // como o usuário quer chamar a assistente (default "Órbita").
  assistantName: text("assistant_name").notNull().default("Órbita"),
  // como o usuário quer ser chamado.
  userName: text("user_name"),
  // instruções livres de tom/estilo/preferências ("seja direto", "me chame de você"…).
  persona: text("persona"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Profile = typeof profile.$inferSelect;
