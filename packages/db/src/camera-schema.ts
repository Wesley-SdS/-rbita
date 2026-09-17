import { pgTable, text, timestamp, uuid, real, boolean, index } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { person, room } from "./home-schema";

/**
 * Onda 5 (câmeras): percepção, narração, gestos, segurança. Frigate (ou
 * qualquer NVR/script que fale HTTP) é a camada de detecção — a Órbita nunca
 * recebe vídeo contínuo, só eventos pontuais (B do briefing §7.1). Zero
 * hardcode: câmera e cômodo são cadastrados pela UI, sem lista fixa.
 */

/**
 * Câmera cadastrada pelo dono. `webhookToken` autentica o POST de ingestão
 * (não é o mesmo mecanismo de sessão do Better Auth: quem publica o evento é
 * o Frigate/script externo, não um navegador logado). Desligar a câmera
 * (`enabled=false`) É o opt-out por cômodo (B do briefing §7.1: "privacidade
 * não é opcional aqui").
 */
export const camera = pgTable("camera", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  roomId: uuid("room_id").references(() => room.id, { onDelete: "set null" }),
  provider: text("provider").notNull().default("generic"), // "frigate" | "generic" — só rótulo, não muda o parser
  webhookToken: text("webhook_token").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  /**
   * Identificar quem aparece nesta câmera (Onda 10). Desligado por padrão: é
   * opt-in por câmera. Com isto ligado, a narração da cena usa SÓ modelo local
   * (decisão 9.6, PRD §4.2) e a presença por cômodo é atualizada.
   */
  identifyFaces: boolean("identify_faces").notNull().default(false),
  /** Reconhecer gestos nesta câmera (CAM.4). Pose/mão é pipeline separado da narração. */
  detectGestures: boolean("detect_gestures").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Evento pontual recebido de uma câmera (motion/objeto detectado). O snapshot
 * é a única imagem guardada (data URL, tamanho limitado por `cameras.snapshotMaxKB`)
 * — nunca vídeo. `narration` só é preenchida sob demanda (decisão do dono:
 * narração por padrão é sob demanda, não contínua), quando alguém pergunta
 * "o que está acontecendo" e a Órbita chama o VLM sobre o keyframe mais recente.
 */
export const cameraEvent = pgTable(
  "camera_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cameraId: uuid("camera_id")
      .notNull()
      .references(() => camera.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull(), // "person", "car", "motion"... vocabulário do provider, não nosso enum
    zone: text("zone"),
    score: real("score"),
    snapshot: text("snapshot"), // data URL (image/jpeg;base64,...), capado no ingest
    narration: text("narration"),
    narratedAt: timestamp("narrated_at"),
    /**
     * Quem foi reconhecido neste evento. Colunas `identified_*` são a convenção
     * que `eraseBiometrics` usa para zerar a referência ao apagar a pessoa.
     */
    identifiedPersonId: uuid("identified_person_id").references(() => person.id, { onDelete: "set null" }),
    identifiedScore: real("identified_score"),
    identifiedOutcome: text("identified_outcome"),
    /** "Desconhecido 2" quando não é ninguém cadastrado */
    identifiedLabel: text("identified_label"),
    identifiedAt: timestamp("identified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("camera_event_camera_created_idx").on(t.cameraId, t.createdAt), index("camera_event_created_idx").on(t.createdAt)],
);

export type Camera = typeof camera.$inferSelect;
export type CameraEvent = typeof cameraEvent.$inferSelect;
