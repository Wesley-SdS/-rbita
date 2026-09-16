import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * Configuração por ferramenta (catálogo com tela, TL.5).
 *
 * A EXISTÊNCIA da tool é código (registro por domínio em packages/core/src/tools);
 * o que o dono controla é se ela está ligada e qual o risco efetivo. Linha
 * ausente = ligada, com o risco declarado no código. `risk_override` só existe
 * quando o dono mudou pela tela; o gate humano é derivado do risco EFETIVO.
 */
export const toolConfig = pgTable("tool_config", {
  name: text("name").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  riskOverride: text("risk_override"), // leitura | escrita | efeito_externo | perigoso | null
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ToolConfig = typeof toolConfig.$inferSelect;
