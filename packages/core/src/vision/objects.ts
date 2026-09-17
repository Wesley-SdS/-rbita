import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { camera, cameraEvent } from "@orbita/db/camera-schema";
import { room } from "@orbita/db/home-schema";
import { visualObject } from "@orbita/db/visual-schema";
import { settings } from "../settings";

/**
 * MEMÓRIA VISUAL de objetos (Onda 11, decisão 9.4 de 17/09): "onde deixei a
 * chave?". Só guarda o que o dono listou em `vision.trackedObjects`, com prazo
 * em `vision.retentionHours`, a partir do rótulo que a própria câmera manda.
 * Sem VLM e sem guardar imagem: é uma linha dizendo "chave, cozinha, 14h12".
 */

/** O rótulo do evento casa com algum objeto rastreado? Puro (acento e caixa não importam). */
export function matchTrackedLabel(label: string, tracked: readonly string[]): string | null {
  const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const alvo = normal(label);
  if (!alvo) return null;
  for (const t of tracked) {
    const n = normal(t);
    if (!n) continue;
    // "chaves" casa com "chave" e vice-versa, sem lista de plurais no código
    if (alvo === n || alvo.startsWith(n) || n.startsWith(alvo)) return t.trim();
  }
  return null;
}

export interface SeenObject {
  label: string;
  roomName: string | null;
  cameraName: string | null;
  zone: string | null;
  score: number | null;
  seenAt: Date;
}

/** Registra o objeto visto num evento de câmera, se estiver na lista do dono. */
export async function recordVisualObject(ev: { id: string; userId: string; cameraId: string; roomId: string | null; label: string; score: number | null; zone: string | null }): Promise<string | null> {
  const cfg = await settings.getMany(["vision.trackedObjects", "vision.retentionHours"]);
  const alvo = matchTrackedLabel(ev.label, cfg["vision.trackedObjects"]);
  if (!alvo) return null;
  await db.insert(visualObject).values({
    userId: ev.userId,
    label: alvo.toLowerCase(),
    cameraId: ev.cameraId,
    roomId: ev.roomId,
    eventId: ev.id,
    score: ev.score,
    zone: ev.zone,
    expiresAt: new Date(Date.now() + cfg["vision.retentionHours"] * 3_600_000),
  });
  return alvo;
}

/** Onde e quando este objeto foi visto pela última vez (do mais recente para o mais antigo). */
export async function findObject(ownerUserId: string, termo: string, limite = 5): Promise<SeenObject[]> {
  const cfg = await settings.get("vision.trackedObjects");
  const alvo = matchTrackedLabel(termo, cfg) ?? termo;
  const rows = await db
    .select({
      label: visualObject.label,
      roomName: room.name,
      cameraName: camera.name,
      zone: visualObject.zone,
      score: visualObject.score,
      seenAt: visualObject.seenAt,
    })
    .from(visualObject)
    .leftJoin(room, eq(room.id, visualObject.roomId))
    .leftJoin(camera, eq(camera.id, visualObject.cameraId))
    .where(and(eq(visualObject.userId, ownerUserId), gt(visualObject.expiresAt, new Date()), sql`${visualObject.label} like ${alvo.toLowerCase() + "%"}`))
    .orderBy(desc(visualObject.seenAt))
    .limit(limite);
  return rows;
}

/** O que a casa viu num período, com nome de quem apareceu (RS/VS: resumo do dia). */
export async function cameraDigest(ownerUserId: string, desde: Date, ate: Date, limite = 200) {
  const rows = await db
    .select({
      id: cameraEvent.id,
      label: cameraEvent.label,
      zone: cameraEvent.zone,
      score: cameraEvent.score,
      createdAt: cameraEvent.createdAt,
      cameraName: camera.name,
      roomName: room.name,
      personId: cameraEvent.identifiedPersonId,
      outcome: cameraEvent.identifiedOutcome,
      desconhecido: cameraEvent.identifiedLabel,
      narration: cameraEvent.narration,
    })
    .from(cameraEvent)
    .innerJoin(camera, eq(camera.id, cameraEvent.cameraId))
    .leftJoin(room, eq(room.id, camera.roomId))
    .where(and(eq(cameraEvent.userId, ownerUserId), gt(cameraEvent.createdAt, desde), lt(cameraEvent.createdAt, ate)))
    .orderBy(desc(cameraEvent.createdAt))
    .limit(limite);
  return rows;
}

/** Retenção da memória visual (decisão 9.4), chamada pelo scheduler. */
export async function purgeExpiredVisualObjects(): Promise<number> {
  const r = await db.delete(visualObject).where(lt(visualObject.expiresAt, new Date())).returning({ id: visualObject.id });
  return r.length;
}

/** Objetos da lista que já apareceram alguma vez (para a tela sugerir). */
export async function knownObjectLabels(ownerUserId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ label: visualObject.label }).from(visualObject).where(eq(visualObject.userId, ownerUserId));
  return rows.map((r) => r.label);
}

/** Apaga a memória visual ligada a eventos de câmeras que sumiram (usado em testes e manutenção). */
export async function deleteObjectsOfCameras(cameraIds: string[]): Promise<void> {
  if (!cameraIds.length) return;
  await db.delete(visualObject).where(inArray(visualObject.cameraId, cameraIds));
}
