import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Tabelas de autenticação (Better Auth).
export * from "./auth-schema";
// Tabelas de chat (conversas + mensagens).
export * from "./chat-schema";
// Tabelas de conhecimento (documentos + chunks + memória, com pgvector).
export * from "./knowledge-schema";
// Tabelas de finanças (skill de gastos).
export * from "./finance-schema";
// Tabelas de rotinas + notificações (proatividade).
export * from "./routine-schema";
// Conexões OAuth com serviços externos (conectores).
export * from "./connector-schema";
// To-do list do dia a dia.
export * from "./todo-schema";
// Fila de ações destrutivas (gate humano — aprovação na UI).
export * from "./action-schema";
// Extensões: skills (comportamentos) + servidores MCP (ferramentas externas).
export * from "./extension-schema";
// Widgets do dashboard (cards pináveis: cotação, clima, nota, checklist).
export * from "./widget-schema";
// Perfil/persona configurável do usuário (personalização persistente).
export * from "./profile-schema";
// Inscrições Web Push (notificações do navegador).
export * from "./push-schema";
// Configuração chave/valor (zero hardcode: default no código, sobrescrita aqui).
export * from "./setting-schema";
// Trilha de eventos (event bus persistido, outbox lido pelo apps/api).
export * from "./event-schema";
// Regras proativas (evento → condição → ação).
export * from "./rule-schema";
// Configuração por ferramenta (ligada/desligada, risco sobrescrito).
export * from "./tool-schema";
// Reuniões: dedup de aviso de agenda + cursor do watch de e-mail (Onda 2).
export * from "./meeting-schema";
// A casa: Home Assistant, cômodos, entidades, risco por domínio, pessoas (Onda 3).
export * from "./home-schema";
// Canais: WhatsApp configurável pela UI, sem env fixo (Onda 4).
export * from "./channels-schema";
// Câmeras: cadastro + eventos pontuais de detecção, sem vídeo contínuo (Onda 5).
export * from "./camera-schema";
// Dono explícito da instância: quem altera config global (Fase 2, RV.1).
export * from "./owner-schema";
// Identidade: consentimento biométrico, auditoria, permissão sobre pessoas (Fase 2).
export * from "./identity-schema";
// Biometria (voz agora, rosto na Onda 10). Nunca sai de casa; some com a pessoa.
export * from "./biometric-schema";

/** Tabela mínima para validar a esteira de migração (Fase 0). */
export const meta = pgTable("meta", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Meta = typeof meta.$inferSelect;
export type NewMeta = typeof meta.$inferInsert;
