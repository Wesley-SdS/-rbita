import { pgTable, text, timestamp, uuid, jsonb, real, bigserial, boolean, index, unique } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { person } from "./home-schema";

/**
 * FASE 2 (identidade e percepção): consentimento, auditoria e permissão sobre
 * pessoas. Biometria em si (amostras, vetores de voz e rosto) mora em tabelas
 * `biometric_*` das Ondas 9 e 10; a regra de apagar pega QUALQUER tabela com
 * esse prefixo, então ninguém precisa lembrar de atualizar o apagamento.
 *
 * Invariantes (PRD §4, inegociáveis): biometria nunca sai de casa; nada é
 * cadastrado sem consentimento registrado; apagar é apagar tudo; toda
 * identificação é auditada; perguntar sobre outra pessoa exige permissão.
 */

/**
 * Consentimento biométrico: QUEM consentiu, QUANDO, e O QUÊ (tipos e o texto
 * exato do termo aceito, não só uma versão). Revogar não apaga a linha: guarda
 * que houve consentimento e quando acabou; a biometria em si é apagada à parte.
 */
export const biometricConsent = pgTable(
  "biometric_consent",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    /** "voz" | "rosto" */
    kinds: text("kinds").array().notNull(),
    /** a própria pessoa, ou o responsável (obrigatório para menor) */
    grantedBy: text("granted_by", { enum: ["propria_pessoa", "responsavel"] }).notNull(),
    guardianPersonId: uuid("guardian_person_id").references(() => person.id, { onDelete: "set null" }),
    /** nome de quem consentiu como responsável, preservado mesmo se o cadastro dele sumir */
    guardianName: text("guardian_name"),
    termVersion: text("term_version").notNull(),
    termText: text("term_text").notNull(),
    /** conta que registrou o consentimento na tela */
    recordedByUserId: text("recorded_by_user_id").notNull(),
    grantedAt: timestamp("granted_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("biometric_consent_person_idx").on(t.personId)],
);

/**
 * Trilha de identidade: cada identificação (com confiança), consulta sobre
 * outra pessoa, consentimento, revogação e apagamento. Ao apagar a biometria de
 * alguém, as linhas que o identificam somem junto e fica só um registro
 * anônimo de que houve apagamento.
 */
export const identityAudit = pgTable(
  "identity_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** identificacao | consulta | consulta_negada | consentimento | revogacao | apagamento | cadastro */
    action: text("action").notNull(),
    /** sobre quem (null em registro anônimo de apagamento) */
    personId: uuid("person_id").references(() => person.id, { onDelete: "cascade" }),
    /** quem perguntou ou agiu, quando é uma pessoa da casa */
    actorPersonId: uuid("actor_person_id").references(() => person.id, { onDelete: "set null" }),
    /** voz | rosto, quando é identificação */
    kind: text("kind"),
    /** reuniao | comando | camera | tela | chat */
    source: text("source"),
    confidence: real("confidence"),
    /** identificado | provavel | desconhecido | permitido | negado */
    outcome: text("outcome"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("identity_audit_user_created_idx").on(t.userId, t.createdAt), index("identity_audit_person_idx").on(t.personId)],
);

/**
 * Quem pode perguntar sobre quem ("a Anna já saiu?"). Sem linha, vale a regra
 * padrão (`identity.askAboutOthersDefault`); a linha explícita sempre vence.
 */
export const personVisibility = pgTable(
  "person_visibility",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    viewerPersonId: uuid("viewer_person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    subjectPersonId: uuid("subject_person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    allowed: boolean("allowed").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("person_visibility_pair").on(t.viewerPersonId, t.subjectPersonId)],
);

export type BiometricConsent = typeof biometricConsent.$inferSelect;
export type IdentityAudit = typeof identityAudit.$inferSelect;
export type PersonVisibility = typeof personVisibility.$inferSelect;
