import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@orbita/db";
import { guidedTask, type GuidedTask } from "@orbita/db/guided-schema";
import { camera } from "@orbita/db/camera-schema";
import { room } from "@orbita/db/home-schema";
import { settings } from "../settings";
import { events } from "../events/index";
import { findCamera } from "../cameras/query";
import { IdentityError } from "../identity/errors";
import { normalizarPassos } from "./rules";

/**
 * Acompanhar uma tarefa passo a passo ("me ajuda com essa receita", PRD §5.4).
 * Aqui mora o ciclo de vida; quem olha a câmera é o `watch.ts`, chamado pelo
 * processo persistente.
 *
 * Duas decisões que valem comentário:
 *   - a tarefa nasce com PRAZO. Isso é câmera olhando gente de tempos em
 *     tempos, então esquecer de encerrar não pode virar vigilância;
 *   - uma tarefa ativa por vez. Duas câmeras olhando e falando ao mesmo tempo
 *     confundiriam mais do que ajudariam, e a máquina é CPU.
 */

export interface StartInput {
  titulo: string;
  passos: string[];
  /** nome do cômodo ou da câmera; sem isso não há o que olhar */
  comodo: string;
  personId?: string | null;
}

export async function startGuidedTask(ownerUserId: string, input: StartInput): Promise<GuidedTask> {
  const cfg = await settings.getMany(["guided.intervalSeconds", "guided.maxMinutes", "guided.maxSteps"]);
  const passos = normalizarPassos(input.passos, cfg["guided.maxSteps"]);
  if (!passos.length) throw new IdentityError("Preciso dos passos da tarefa para poder acompanhar.", 400);

  const cam = await findCamera(ownerUserId, input.comodo);
  if (!cam) throw new IdentityError(`Não achei uma câmera ligada para "${input.comodo}".`, 404);

  const ativa = await currentGuidedTask(ownerUserId);
  if (ativa) throw new IdentityError(`Já estou acompanhando "${ativa.title}". Encerre antes de começar outra.`, 409);

  const agora = new Date();
  const [row] = await db
    .insert(guidedTask)
    .values({
      userId: ownerUserId,
      personId: input.personId ?? null,
      title: input.titulo.trim().slice(0, 120),
      steps: passos,
      currentStep: 0,
      cameraId: cam.id,
      roomId: cam.roomId,
      intervalSeconds: cfg["guided.intervalSeconds"],
      expiresAt: new Date(agora.getTime() + cfg["guided.maxMinutes"] * 60_000),
    })
    .returning();

  await events.emit("guided.started", { taskId: row!.id, titulo: row!.title, passos: passos.length, cameraId: cam.id, roomId: cam.roomId }, { userId: ownerUserId });
  return row!;
}

/** A tarefa ativa do dono (no máximo uma). */
export async function currentGuidedTask(ownerUserId: string): Promise<GuidedTask | null> {
  const [row] = await db
    .select()
    .from(guidedTask)
    .where(and(eq(guidedTask.userId, ownerUserId), eq(guidedTask.status, "ativa")))
    .orderBy(desc(guidedTask.createdAt))
    .limit(1);
  return row ?? null;
}

export interface GuidedView {
  id: string;
  titulo: string;
  passos: string[];
  passoAtual: number;
  status: string;
  comodo: string | null;
  camera: string | null;
  intervaloSegundos: number;
  ultimaOlhada: Date | null;
  ultimaObservacao: string | null;
  expiraEm: Date;
}

/** Tarefas do dono para a tela, da mais nova para a mais velha. */
export async function listGuidedTasks(ownerUserId: string, limite = 10): Promise<GuidedView[]> {
  const rows = await db
    .select({ t: guidedTask, comodo: room.name, cam: camera.name })
    .from(guidedTask)
    .leftJoin(room, eq(room.id, guidedTask.roomId))
    .leftJoin(camera, eq(camera.id, guidedTask.cameraId))
    .where(eq(guidedTask.userId, ownerUserId))
    .orderBy(desc(guidedTask.createdAt))
    .limit(limite);
  return rows.map(({ t, comodo, cam }) => ({
    id: t.id,
    titulo: t.title,
    passos: t.steps,
    passoAtual: t.currentStep,
    status: t.status,
    comodo,
    camera: cam,
    intervaloSegundos: t.intervalSeconds,
    ultimaOlhada: t.lastLookAt,
    ultimaObservacao: t.lastObservation,
    expiraEm: t.expiresAt,
  }));
}

async function carregar(ownerUserId: string, id: string): Promise<GuidedTask> {
  const [row] = await db.select().from(guidedTask).where(and(eq(guidedTask.id, id), eq(guidedTask.userId, ownerUserId))).limit(1);
  if (!row) throw new IdentityError("Tarefa não encontrada", 404);
  return row;
}

/** Encerra por vontade do dono (ou porque a tarefa acabou). */
export async function stopGuidedTask(ownerUserId: string, id: string | null, status: "cancelada" | "concluida" = "cancelada"): Promise<GuidedTask | null> {
  const alvo = id ? await carregar(ownerUserId, id) : await currentGuidedTask(ownerUserId);
  if (!alvo || alvo.status !== "ativa") return null;
  const [row] = await db
    .update(guidedTask)
    .set({ status, updatedAt: new Date() })
    .where(eq(guidedTask.id, alvo.id))
    .returning();
  await events.emit("guided.finished", { taskId: alvo.id, titulo: alvo.title, status }, { userId: ownerUserId });
  return row ?? null;
}

/** Avança um passo à mão (o dono disse "pronto" em vez de esperar a câmera). */
export async function setGuidedStep(ownerUserId: string, id: string | null, passo: number): Promise<GuidedTask | null> {
  const alvo = id ? await carregar(ownerUserId, id) : await currentGuidedTask(ownerUserId);
  if (!alvo || alvo.status !== "ativa") return null;
  const limite = Math.max(0, Math.min(passo, alvo.steps.length));
  if (limite >= alvo.steps.length) return stopGuidedTask(ownerUserId, alvo.id, "concluida");
  const [row] = await db
    .update(guidedTask)
    .set({ currentStep: limite, updatedAt: new Date() })
    .where(eq(guidedTask.id, alvo.id))
    .returning();
  return row ?? null;
}

/** Tarefas ativas de todos os donos, para o laço do processo persistente. */
export async function activeGuidedTasks(limite = 20): Promise<GuidedTask[]> {
  return db.select().from(guidedTask).where(eq(guidedTask.status, "ativa")).orderBy(guidedTask.lastLookAt).limit(limite);
}

/** Fecha o que passou do prazo. Prazo é a trava contra virar vigilância. */
export async function expireGuidedTasks(): Promise<number> {
  const vencidas = await db
    .update(guidedTask)
    .set({ status: "expirada", updatedAt: new Date() })
    .where(and(eq(guidedTask.status, "ativa"), lt(guidedTask.expiresAt, new Date())))
    .returning({ id: guidedTask.id, userId: guidedTask.userId, title: guidedTask.title });
  for (const v of vencidas) {
    await events.emit("guided.finished", { taskId: v.id, titulo: v.title, status: "expirada" }, { userId: v.userId }).catch(() => undefined);
  }
  return vencidas.length;
}

/** Apaga tarefas encerradas mais velhas que a retenção configurada. */
export async function purgeOldGuidedTasks(dias: number): Promise<number> {
  const corte = new Date(Date.now() - dias * 86_400_000);
  const r = await db
    .delete(guidedTask)
    .where(and(inArray(guidedTask.status, ["concluida", "cancelada", "expirada"]), lt(guidedTask.updatedAt, corte)))
    .returning({ id: guidedTask.id });
  return r.length;
}
