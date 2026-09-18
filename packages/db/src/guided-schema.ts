import { pgTable, text, timestamp, uuid, integer, jsonb, index } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { person, room } from "./home-schema";
import { camera } from "./camera-schema";

/**
 * ACOMPANHAR UMA TAREFA PASSO A PASSO ("me ajuda com essa receita", PRD §5.4).
 *
 * A Órbita guarda os passos, olha a câmera do cômodo de tempos em tempos e
 * avisa o próximo passo quando o atual terminou. Três cuidados que estão no
 * schema de propósito, porque é câmera olhando gente:
 *   - `expires_at`: toda tarefa nasce com prazo. Tarefa esquecida não vira
 *     câmera vigiando a cozinha para sempre;
 *   - `camera_id` com cascade: sumiu a câmera, some o acompanhamento;
 *   - `person_id`: por onde avisar (a notificação segue a pessoa, Onda 12).
 *
 * O que a câmera responde NÃO é guardado como imagem: só o texto curto da
 * última observação, que é o que a tela mostra.
 */
export const guidedTask = pgTable(
  "guided_task",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** quem está fazendo a tarefa: define por onde a Órbita avisa */
    // cascade: "apagar é apagar" (PRD §4.5). A tarefa diz o que a pessoa fez e
    // onde, então some com ela
    personId: uuid("person_id").references(() => person.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** passos em ordem, como texto curto */
    steps: jsonb("steps").$type<string[]>().notNull().default([]),
    /** índice do passo atual dentro de `steps` */
    currentStep: integer("current_step").notNull().default(0),
    cameraId: uuid("camera_id").references(() => camera.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => room.id, { onDelete: "set null" }),
    /** ativa | concluida | cancelada | expirada */
    status: text("status").notNull().default("ativa"),
    /** de quanto em quanto tempo olhar (nasce da config, muda por tarefa) */
    intervalSeconds: integer("interval_seconds").notNull(),
    lastLookAt: timestamp("last_look_at"),
    /** o que a câmera respondeu na última olhada, em uma linha */
    lastObservation: text("last_observation"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("guided_task_ativa_idx").on(t.status, t.lastLookAt), index("guided_task_user_idx").on(t.userId, t.createdAt)],
);

export type GuidedTask = typeof guidedTask.$inferSelect;
