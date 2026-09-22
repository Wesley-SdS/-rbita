import { and, desc, eq, ilike, isNotNull, or } from "drizzle-orm";
import { db } from "@orbita/db";
import { camera, cameraEvent, type Camera, type CameraEvent } from "@orbita/db/camera-schema";
import { person, room } from "@orbita/db/home-schema";

/**
 * Achar câmera por nome (dela ou do cômodo). Diferente das entidades do Home
 * Assistant (150-400, precisam de busca semântica), uma casa tem poucas
 * câmeras: substring simples resolve "a câmera da sala"/"sala" sem embedding.
 */
export async function findCamera(userId: string, query: string): Promise<Camera | null> {
  const q = `%${query.trim()}%`;
  const rows = await db
    .select({ camera })
    .from(camera)
    .leftJoin(room, eq(camera.roomId, room.id))
    .where(and(eq(camera.userId, userId), eq(camera.enabled, true), or(ilike(camera.name, q), ilike(room.name, q))))
    .limit(1);
  return rows[0]?.camera ?? null;
}

export async function listCameras(userId: string): Promise<Camera[]> {
  return db.select().from(camera).where(eq(camera.userId, userId)).orderBy(camera.name);
}

/**
 * A última imagem da câmera — e, opcionalmente, só se ela for RECENTE.
 *
 * Sem a idade, "o que você está vendo?" podia ser respondido com um quadro de
 * três horas atrás, e a Órbita descreveria a cozinha de manhã como se fosse
 * agora. Imagem velha não é imagem: é outra pergunta, respondida com
 * confiança que ela não tem.
 */
export async function latestEventWithSnapshot(cameraId: string, maxIdadeSegundos?: number): Promise<CameraEvent | null> {
  const [ev] = await db
    .select()
    .from(cameraEvent)
    .where(and(eq(cameraEvent.cameraId, cameraId), isNotNull(cameraEvent.snapshot)))
    .orderBy(desc(cameraEvent.createdAt))
    .limit(1);
  if (!ev) return null;
  if (maxIdadeSegundos !== undefined && Date.now() - ev.createdAt.getTime() > maxIdadeSegundos * 1000) return null;
  return ev;
}

/** Quanto tempo faz, em segundos, que esta imagem foi capturada. Puro. */
export function idadeEmSegundos(quando: Date, agora = new Date()): number {
  return Math.max(0, Math.round((agora.getTime() - quando.getTime()) / 1000));
}

export interface RecentEvent extends CameraEvent {
  /** nome de quem foi reconhecido (null quando foi desconhecido ou sem identificação) */
  identifiedName: string | null;
}

export async function recentEvents(userId: string, cameraId: string | null, limit = 30): Promise<RecentEvent[]> {
  const where = cameraId ? and(eq(cameraEvent.userId, userId), eq(cameraEvent.cameraId, cameraId)) : eq(cameraEvent.userId, userId);
  // o nome vem junto: a tela precisa dele para mostrar "Anna, provavelmente
  // (82%)" em vez de um uuid, e o id sozinho não diria nada a ninguém
  const rows = await db
    .select({ ev: cameraEvent, nome: person.name })
    .from(cameraEvent)
    .leftJoin(person, eq(person.id, cameraEvent.identifiedPersonId))
    .where(where)
    .orderBy(desc(cameraEvent.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.ev, identifiedName: r.nome ?? null }));
}

/**
 * Só confere posse (sem trazer `snapshot`, que pode ter centenas de KB por
 * linha) — usada antes de narrar, para não deixar um usuário narrar o
 * evento de outro. Também não tem teto de "últimos N": um evento antigo
 * continua contável do dono dele (achado de auditoria pós-Onda 6).
 */
export async function eventBelongsToUser(userId: string, eventId: string): Promise<boolean> {
  const [row] = await db.select({ id: cameraEvent.id }).from(cameraEvent).where(and(eq(cameraEvent.id, eventId), eq(cameraEvent.userId, userId))).limit(1);
  return row !== undefined;
}

/** Nome do cômodo da câmera (null quando ela não tem cômodo associado). */
export async function cameraRoomName(cam: Camera): Promise<string | null> {
  if (!cam.roomId) return null;
  const [r] = await db.select({ name: room.name }).from(room).where(eq(room.id, cam.roomId)).limit(1);
  return r?.name ?? null;
}
