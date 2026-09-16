import { pgTable, text, timestamp, uuid, integer, vector, index } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const document = pgTable("document", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  source: text("source").notNull().default("text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chunk = pgTable(
  "chunk",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    idx: integer("idx").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("chunk_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

// Memória de longo prazo (fatos / preferências do usuário).
export const memory = pgTable(
  "memory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("memory_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

export type Document = typeof document.$inferSelect;
export type Chunk = typeof chunk.$inferSelect;
