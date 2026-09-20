import { pgTable, text, timestamp, uuid, integer, real, vector, jsonb, index, uniqueIndex, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";
import { conversation } from "./chat-schema";

/**
 * Coluna de busca textual do Postgres. O Drizzle não tem `tsvector` nativo, e
 * ela nunca é lida pela aplicação (só usada no `@@` e no `ts_rank_cd`), então
 * basta declarar o tipo para as migrações e os índices existirem.
 *
 * A configuração `portuguese_unaccent` (criada na migração) é a `portuguese`
 * com `unaccent` no mapeamento: "energia eletrica" acha "energia elétrica", e
 * "garantias" acha "garantia" pelo radical. Precisa ser uma CONFIGURAÇÃO
 * NOMEADA porque `unaccent()` é STABLE, não IMMUTABLE, e não entraria numa
 * coluna gerada como chamada de função.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});
const FTS_PORTUGUES = (coluna: string) => sql.raw(`to_tsvector('public.portuguese_unaccent'::regconfig, coalesce(${coluna}, ''))`);

export const document = pgTable("document", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  source: text("source").notNull().default("text"),
  // SHA-256 do arquivo original: o mesmo documento enviado duas vezes não é
  // indexado duas vezes (o índice único por usuário garante). Nulo em documento
  // que não veio de arquivo (texto colado, reunião).
  fileHash: text("file_hash"),
  /** Páginas do arquivo de origem, quando ele tem páginas (PDF). */
  pages: integer("pages"),
  /**
   * Texto lido do documento, com as páginas separadas por "\n\n" (é o mesmo
   * texto em que `chunk.char_start`/`char_end` apontam). Guardado por dois
   * motivos: a tela abre o trecho citado no contexto em volta, e reindexar
   * pode CORTAR de novo em vez de só recalcular o vetor dos cortes antigos.
   * Nulo em documento indexado antes disso existir.
   */
  content: text("content"),
  /**
   * Onde cada página começa dentro de `content` (índice do primeiro caractere).
   * Sem isso, recortar de novo perderia a divisão de páginas: separador de
   * página e separador de parágrafo são a mesma sequência no texto.
   */
  pageOffsets: jsonb("page_offsets").$type<number[]>(),
  // Rótulos de locutor → nome real ({"A":"Ana","B":"Bruno"}), só em documentos de
  // reunião com diarização. É METADADO de exibição: o texto arquivado mantém
  // "Locutor A", a UI substitui na leitura. Nulo = nenhum locutor nomeado ainda.
  speakers: jsonb("speakers").$type<Record<string, string>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(t) => [
  // dedup de arquivo: parcial, porque documento sem arquivo tem hash nulo
  uniqueIndex("document_user_file_hash_idx").on(t.userId, t.fileHash).where(sql`${t.fileHash} is not null`),
  // o único acima é PARCIAL: não serve para listar os documentos do dono
  index("document_user_created_idx").on(t.userId, t.createdAt),
]);

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
    // Onde este trecho está no documento de origem. A resposta cita "página 4"
    // e a tela abre o trecho exato em vez de mandar o dono procurar. Nulo nos
    // trechos indexados antes disso existir (reindexar preenche).
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    fts: tsvector("fts").generatedAlwaysAs(() => FTS_PORTUGUES("content")),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("chunk_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunk_fts_idx").using("gin", t.fts),
    index("chunk_document_idx").on(t.documentId),
    // contagem do acervo e reindexação varrem por dono
    index("chunk_user_idx").on(t.userId),
  ],
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
    /** De onde veio: o dono digitou, a tool salvou, ou saiu de uma conversa. */
    source: text("source").notNull().default("manual"),
    /** Assunto (saude, dinheiro, terceiros, relacionamento, geral): decide o que sempre pergunta. */
    category: text("category"),
    fts: tsvector("fts").generatedAlwaysAs(() => FTS_PORTUGUES("content")),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("memory_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("memory_fts_idx").using("gin", t.fts),
    // o HNSW e o GIN acima servem à busca, não a "liste/conte as minhas"
    index("memory_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * CANDIDATO A MEMÓRIA (B4.1): o que a Órbita achou que vale lembrar e ainda não
 * é memória. Confiança alta grava sozinha e deixa desfazer; o resto espera o
 * dono confirmar na tela, e assunto sensível sempre espera, por mais certa que
 * a extração pareça.
 *
 * É tabela própria (e não uma coluna "pendente" em `memory`) porque candidato
 * NÃO pode ser encontrado pela busca: enquanto não foi confirmado, não é fato.
 */
export const memoryCandidate = pgTable(
  "memory_candidate",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** de qual conversa saiu (para a tela mostrar o contexto e o dono julgar) */
    conversationId: uuid("conversation_id").references(() => conversation.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    /** trecho da conversa que sustenta o fato: sem evidência o dono não tem como decidir */
    evidence: text("evidence"),
    category: text("category").notNull().default("geral"),
    /** 0 a 1, dada pelo modelo na extração */
    confidence: real("confidence").notNull(),
    /** pendente (esperando o dono), salvo, descartado */
    status: text("status", { enum: ["pendente", "salvo", "descartado"] }).notNull().default("pendente"),
    /** por que parou aqui: confianca_baixa, assunto_sensivel, ou salvo_automatico */
    reason: text("reason").notNull().default("confianca_baixa"),
    /** memória existente parecida: confirmar ATUALIZA ela em vez de criar uma segunda */
    similarTo: uuid("similar_to").references(() => memory.id, { onDelete: "set null" }),
    /** memória criada a partir deste candidato (permite desfazer o salvamento automático) */
    memoryId: uuid("memory_id").references(() => memory.id, { onDelete: "set null" }),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("memory_candidate_user_status_idx").on(t.userId, t.status),
    index("memory_candidate_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export type Document = typeof document.$inferSelect;
export type Chunk = typeof chunk.$inferSelect;
export type Memory = typeof memory.$inferSelect;
export type MemoryCandidate = typeof memoryCandidate.$inferSelect;
