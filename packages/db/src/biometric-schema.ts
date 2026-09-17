import { pgTable, text, timestamp, uuid, real, integer, index, unique } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { person } from "./home-schema";

/**
 * BIOMETRIA (Fase 2, Ondas 9 e 10). Tudo aqui é dado biométrico: nunca sai de
 * casa (PRD §4.1), só existe com consentimento vigente, e some com a pessoa.
 *
 * Convenções que o código de apagar e os testes usam (não quebre):
 *   - nome da tabela começa com `biometric_` → `eraseBiometrics` apaga sozinho
 *   - `person_id` com FK cascade → remover a pessoa leva tudo junto
 *   - arquivo isolado (`@orbita/db/biometric-schema`) → o teste NV.1 reprova
 *     qualquer módulo que fala com nuvem e importa daqui
 *
 * Vetor em `real[]` e não `vector(n)`: cada modelo tem uma dimensão (TitaNet
 * 192, CAM++ 512, ArcFace 512, SFace 128) e o número de pessoas de uma casa é
 * pequeno; o casamento é feito em memória (identity/match.ts). Índice HNSW não
 * compensa aqui e prenderia a coluna a um modelo.
 */

/**
 * Amostra de voz de CADASTRO. O áudio bruto fica cifrado (AES-256-GCM, mesma
 * chave dos tokens) para recalcular assinaturas quando o modelo trocar. Amostra
 * vinda de reunião não guarda áudio: só o vetor (a reunião inteira não é salva).
 */
export const biometricVoiceSample = pgTable(
  "biometric_voice_sample",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    /** cadastro (gravação na tela) | reuniao (fala nomeada) | correcao (nome corrigido) | comando */
    source: text("source").notNull(),
    audioEnc: text("audio_enc"),
    mime: text("mime"),
    durationS: real("duration_s"),
    speechS: real("speech_s"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("biometric_voice_sample_person_idx").on(t.personId)],
);

/** Assinatura de voz: um vetor por amostra, por MODELO (vetores de modelos diferentes não se comparam). */
export const biometricVoiceEmbedding = pgTable(
  "biometric_voice_embedding",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    sampleId: uuid("sample_id").references(() => biometricVoiceSample.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    dim: integer("dim").notNull(),
    vector: real("vector").array().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("biometric_voice_embedding_person_model_idx").on(t.personId, t.model)],
);

/**
 * Voz DESCONHECIDA efêmera (decisão 9.2, 17/09): "Desconhecido 1" de uma
 * reunião, guardado por `identity.unknownRetentionDays` (padrão 7) para ser
 * reconhecido de novo ou nomeado depois. Sem pessoa, sem cadastro: some sozinho.
 */
export const biometricUnknownVoice = pgTable(
  "biometric_unknown_voice",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    model: text("model").notNull(),
    vector: real("vector").array().notNull(),
    /** de onde veio (ex.: id do documento da reunião), para a tela mostrar contexto */
    sourceRef: text("source_ref"),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    /** fixo desde a primeira vez: reaparecer NÃO renova (senão viraria rastreio sem prazo) */
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("biometric_unknown_voice_expires_idx").on(t.expiresAt), unique("biometric_unknown_voice_label").on(t.userId, t.label)],
);

export type BiometricVoiceSample = typeof biometricVoiceSample.$inferSelect;
export type BiometricVoiceEmbedding = typeof biometricVoiceEmbedding.$inferSelect;
export type BiometricUnknownVoice = typeof biometricUnknownVoice.$inferSelect;
