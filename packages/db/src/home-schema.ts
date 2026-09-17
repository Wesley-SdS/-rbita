import { pgTable, text, timestamp, uuid, jsonb, vector, index, unique, primaryKey, boolean } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Onda 3 (a casa): Home Assistant como FERRAMENTA, nunca como cérebro
 * (CLAUDE.md §1). Zero hardcode: cômodo, dispositivo, risco por domínio e
 * pessoa da casa são todos DADOS com tela, sem lista fixa no código.
 */

/** Cômodo, cadastrado pela UI. Sem lista fixa (B3.7): o dono cria os que quiser. */
export const room = pgTable("room", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Conexão com UM Home Assistant, por Long-Lived Access Token (B3.1): o HA não
 * fala OAuth2 do jeito que `connectors/registry.ts` espera (o dono gera o
 * token no próprio perfil do HA e cola aqui). `baseUrl` é digitado pelo dono
 * numa tela confiável — é a URL que ganha a exceção estreita de SSRF (B3.2),
 * nunca uma URL vinda de LLM/conteúdo externo.
 */
export const haConnection = pgTable(
  "ha_connection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    baseUrl: text("base_url").notNull(),
    tokenEnc: text("token_enc").notNull(),
    // preenchido no teste de conexão (nome da instância, versão) — só exibição
    label: text("label"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("ha_connection_user").on(t.userId)],
);

/**
 * Espelho local das entidades do HA, com embedding para busca semântica
 * (B3.6: "a luz da sala" → entidade certa — 150-400 entidades não cabem no
 * prompt). Sincronizado por polling (SchedulerService); `lastState` é a
 * última leitura conhecida, não a fonte de verdade (o HA é).
 */
export const haEntity = pgTable(
  "ha_entity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(), // "light.living_room" (id do próprio HA)
    domain: text("domain").notNull(), // "light", "lock", "climate"... (prefixo do entity_id)
    friendlyName: text("friendly_name").notNull(),
    roomId: uuid("room_id").references(() => room.id, { onDelete: "set null" }),
    embedding: vector("embedding", { dimensions: 768 }),
    lastState: jsonb("last_state"), // { state, attributes } — cache, não fonte de verdade
    lastChangedAt: timestamp("last_changed_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("ha_entity_user_entity").on(t.userId, t.entityId),
    index("ha_entity_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/**
 * Risco por DOMÍNIO do HA (B3.8), configurável pela tela — nunca hardcoded no
 * `switch` de uma tool. Linha ausente = usa o default do código
 * (`homeDefaultDomainRisk` em packages/core), do mesmo jeito que `tool_config`
 * na Onda 1. Decisão do dono (17/09): luz/tomada/mídia/clima direto;
 * fechadura/alarme/portão/garagem no gate.
 */
export const haDomainRisk = pgTable(
  "ha_domain_risk",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    risk: text("risk").notNull(), // leitura | escrita | efeito_externo | perigoso
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.domain] })],
);

/**
 * Pessoa da casa (B7.1) — NÃO é multi-tenant (CLAUDE.md §1): todas as pessoas
 * pertencem à MESMA conta/casa do dono (`userId` = o dono). É permissão por
 * pessoa e por cômodo, não isolamento de dados entre organizações.
 */
export const person = pgTable("person", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // dono: tudo liberado · morador: liberado exceto onde restrito · visitante: só onde liberado
  role: text("role", { enum: ["dono", "morador", "visitante"] }).notNull().default("morador"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Acesso explícito de uma pessoa a um cômodo (ver `permission.ts` para a regra completa). */
export const personRoomAccess = pgTable(
  "person_room_access",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => room.id, { onDelete: "cascade" }),
    allowed: boolean("allowed").notNull().default(true),
  },
  (t) => [unique("person_room_access_unique").on(t.personId, t.roomId)],
);

export type Room = typeof room.$inferSelect;
export type HaConnection = typeof haConnection.$inferSelect;
export type HaEntity = typeof haEntity.$inferSelect;
export type HaDomainRisk = typeof haDomainRisk.$inferSelect;
export type Person = typeof person.$inferSelect;
export type PersonRoomAccess = typeof personRoomAccess.$inferSelect;
