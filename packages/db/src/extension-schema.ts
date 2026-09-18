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
  // Risco das tools deste servidor (decisão da Onda 1): "efeito_externo" por
  // padrão, ou seja, toda tool MCP passa pelo gate humano até o dono marcar o
  // servidor como somente leitura. Um MCP desconhecido nunca executa sozinho.
  risk: text("risk").notNull().default("efeito_externo"),
  // Catálogo das tools do servidor, guardado da última conexão boa. É o que
  // permite NÃO conectar a cada mensagem: o modelo vê as tools pelo catálogo,
  // e a conexão só acontece quando uma delas é de fato chamada (se o servidor
  // caiu, a reconexão é nessa hora, não antes).
  toolsCatalog: jsonb("tools_catalog").$type<{ name: string; description?: string; inputSchema?: unknown }[]>(),
  catalogAt: timestamp("catalog_at"),
  /** último erro de conexão, para a tela mostrar por que o servidor está fora */
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Skill = typeof skill.$inferSelect;
export type McpServer = typeof mcpServer.$inferSelect;
