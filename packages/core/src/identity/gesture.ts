import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { camera, cameraEvent } from "@orbita/db/camera-schema";
import { room } from "@orbita/db/home-schema";
import { settings } from "../settings";
import { events } from "../events/index";
import { detectGestures } from "../perception/client";
import { identityAudit } from "@orbita/db/identity-schema";

/**
 * GESTOS (CAM.4, Onda 11). O serviço local diz o NOME do gesto; o que ele faz é
 * decisão do dono, numa REGRA sobre o evento `identity.gesture` (que carrega
 * pessoa, cômodo e gesto). É assim que "o mesmo gesto faz coisas diferentes
 * para cada um" sem nenhuma tabela de comando fixa no código.
 *
 * Nunca aciona nada sozinho: gesto vira evento, e a regra decide. Ação perigosa
 * continua no gate humano, como qualquer outra (CLAUDE.md §5.1).
 */

export interface GestureSeen {
  gesto: string;
  confianca: number;
  personId: string | null;
  nome: string | null;
  roomId: string | null;
}

/**
 * Procura gestos no keyframe de um evento de câmera que tenha gestos ligados.
 * `identificado` vem da identificação de rosto do mesmo evento, quando houve.
 */
export async function detectGestureForEvent(eventId: string): Promise<GestureSeen[]> {
  const [ev] = await db
    .select({
      id: cameraEvent.id,
      userId: cameraEvent.userId,
      snapshot: cameraEvent.snapshot,
      personId: cameraEvent.identifiedPersonId,
      outcome: cameraEvent.identifiedOutcome,
      cameraId: cameraEvent.cameraId,
      cameraName: camera.name,
      roomId: camera.roomId,
      roomName: room.name,
      detecta: camera.detectGestures,
    })
    .from(cameraEvent)
    .innerJoin(camera, eq(camera.id, cameraEvent.cameraId))
    .leftJoin(room, eq(room.id, camera.roomId))
    .where(eq(cameraEvent.id, eventId))
    .limit(1);
  if (!ev || !ev.detecta || !ev.snapshot) return [];

  const habilitados = await settings.get("vision.gestures");
  const sep = ev.snapshot.indexOf(",");
  const mime = /^data:([^;,]+)/.exec(ev.snapshot)?.[1] ?? "image/jpeg";
  const bytes = new Uint8Array(Buffer.from(ev.snapshot.slice(sep + 1), "base64"));

  const r = await detectGestures(bytes, mime);
  const vistos: GestureSeen[] = [];
  for (const g of r.gestos) {
    if (habilitados.length && !habilitados.includes(g.gesto)) continue;
    // só gesto de quem foi RECONHECIDO vira gesto "de alguém"; senão é anônimo
    const personId = ev.outcome === "identificado" ? ev.personId : null;
    vistos.push({ gesto: g.gesto, confianca: g.confianca, personId, nome: null, roomId: ev.roomId });
    await db.insert(identityAudit).values({
      userId: ev.userId,
      action: "gesto",
      personId,
      kind: "gesto",
      source: "camera",
      confidence: g.confianca,
      outcome: g.gesto,
      detail: { camera: ev.cameraName, comodo: ev.roomName, evento: ev.id },
    });
    await events
      .emit(
        "identity.gesture",
        { gesto: g.gesto, confianca: g.confianca, personId, roomId: ev.roomId, comodo: ev.roomName, cameraId: ev.cameraId, camera: ev.cameraName, eventId: ev.id },
        { userId: ev.userId },
      )
      .catch(() => undefined);
  }
  return vistos;
}
