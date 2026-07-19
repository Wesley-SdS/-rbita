import { pgTable, text, timestamp, uuid, boolean, jsonb, vector } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Skills: extensões de comportamento definidas pelo usuário. Uma skill é um
 * bloco de instruções nomeado (ex: "Modo dev: responda com código comentado")
 * que, quando ativo, é injetado no system prompt da Órbita.
 */
export const skill = pgTable("skill", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  instructions: text("instructions").notNull(),
  keywords: text("keywords"), // CSV — usado no roteamento por palavra-chave
  // vetor da skill (nome+keywords+instruções) p/ roteamento semântico por cosseno.
  embedding: vector("embedding", { dimensions: 768 }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Servidores MCP (Model Context Protocol): fontes externas de ferramentas.
 * Ao conectar um servidor MCP (HTTP streamable), suas tools ficam disponíveis
 * para a Órbita no chat. Ex: um MCP de GitHub, de banco de dados, etc.
 */
export const mcpServer = pgTable("mcp_server", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(), // endpoint HTTP streamable do servidor MCP
  headers: jsonb("headers"), // headers opcionais (ex: Authorization)
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Skill = typeof skill.$inferSelect;
export type McpServer = typeof mcpServer.$inferSelect;
