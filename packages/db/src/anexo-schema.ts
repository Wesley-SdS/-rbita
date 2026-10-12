import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { connection } from "./connector-schema";

/**
 * O texto que a Órbita já leu de um anexo de e-mail (PRD de anexos, C2).
 *
 * A segunda pergunta sobre o mesmo anexo ("e o valor da multa?") é instantânea:
 * não baixa nem lê de novo, e um PDF escaneado de 80 páginas não paga OCR duas
 * vezes. Uma linha por (conta, mensagem, anexo); o `sha256` dos bytes deixa
 * reaproveitar a leitura quando o MESMO arquivo chega em outro e-mail.
 *
 * Desconectar a conta apaga o que foi lido dela (cascade na conexão), e a
 * retenção (`anexos.retencaoDias`) apaga o que ficou velho.
 */
export const anexoLido = pgTable(
  "anexo_lido",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conexaoId: uuid("conexao_id")
      .notNull()
      .references(() => connection.id, { onDelete: "cascade" }),
    /** "google" | "microsoft" */
    provedor: text("provedor").notNull(),
    mensagemId: text("mensagem_id").notNull(),
    /** o id ESTÁVEL do anexo (no Gmail, o partId; o attachmentId muda a cada leitura) */
    anexoId: text("anexo_id").notNull(),
    nome: text("nome").notNull(),
    sha256: text("sha256").notNull(),
    tamanho: integer("tamanho").notNull(),
    /** o tipo decidido pelos BYTES ("docx", "pdf"…) e a família ("documento", "planilha"…) */
    tipo: text("tipo").notNull(),
    familia: text("familia").notNull(),
    texto: text("texto").notNull(),
    resumo: text("resumo").notNull(),
    /** avisos, partes, dado estruturado (evento, nota fiscal) e os arquivos de dentro de um ZIP */
    detalhes: jsonb("detalhes").$type<Record<string, unknown>>().notNull().default({}),
    lidoEm: timestamp("lido_em").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("anexo_lido_unico").on(t.userId, t.conexaoId, t.mensagemId, t.anexoId),
    index("anexo_lido_hash").on(t.userId, t.sha256),
    index("anexo_lido_quando").on(t.lidoEm),
  ],
);
export type AnexoLido = typeof anexoLido.$inferSelect;

/**
 * Senhas de anexo por REMETENTE (C5): a fatura do banco vem em PDF protegido
 * pelos primeiros dígitos do CPF, e a Órbita tenta sozinha as senhas daquele
 * domínio.
 *
 * Cadastrada SÓ pela tela, nunca pelo chat nem pela voz: ficaria no histórico
 * da conversa e passaria pelo modelo. A senha é cifrada (AES-256-GCM, a mesma
 * chave dos tokens de conector) e o export da conta a omite (`_enc`).
 */
export const anexoSenha = pgTable(
  "anexo_senha",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "nubank.com.br": vale para o domínio e os subdomínios dele */
    dominio: text("dominio").notNull(),
    /** como o dono reconhece na tela ("fatura do cartão") */
    rotulo: text("rotulo"),
    senhaEnc: text("senha_enc").notNull(),
    criadaEm: timestamp("criada_em").defaultNow().notNull(),
    usadaEm: timestamp("usada_em"),
  },
  (t) => [index("anexo_senha_dominio").on(t.userId, t.dominio)],
);
export type AnexoSenha = typeof anexoSenha.$inferSelect;
