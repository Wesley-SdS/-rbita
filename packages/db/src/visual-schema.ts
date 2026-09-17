import { pgTable, text, timestamp, uuid, real, index } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { room } from "./home-schema";
import { camera, cameraEvent } from "./camera-schema";

/**
 * MEMÓRIA VISUAL de objetos (Onda 11, decisão 9.4): "onde deixei a chave?".
 *
 * Não é vigilância de tudo: só entram os objetos que o dono listou em
 * `vision.trackedObjects` (Ajustes), vindos do rótulo que a própria câmera
 * manda (Frigate detecta "chaves", "mochila", "celular"), e cada linha nasce
 * com prazo de validade (`vision.retentionHours`). Sem VLM no caminho.
 */
export const visualObject = pgTable(
  "visual_object",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** rótulo normalizado (minúsculo), como o dono cadastrou na lista */
    label: text("label").notNull(),
    cameraId: uuid("camera_id").references(() => camera.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => room.id, { onDelete: "set null" }),
    eventId: uuid("event_id").references(() => cameraEvent.id, { onDelete: "cascade" }),
    score: real("score"),
    zone: text("zone"),
    seenAt: timestamp("seen_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [index("visual_object_user_label_idx").on(t.userId, t.label), index("visual_object_expires_idx").on(t.expiresAt)],
);

export type VisualObject = typeof visualObject.$inferSelect;
