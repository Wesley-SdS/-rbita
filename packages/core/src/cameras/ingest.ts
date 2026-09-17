import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { camera, cameraEvent, type Camera } from "@orbita/db/camera-schema";
import { room } from "@orbita/db/home-schema";
import { settings } from "../settings";
import { events } from "../events/index";
import { narrateCameraEvent } from "./narrate";
import { log } from "../observability/logger";
import { recordVisualObject } from "../vision/objects";

/**
 * Ingestão de eventos de câmera (Onda 5, briefing §7.1): quem detecta é um
 * NVR externo (Frigate ou qualquer script que fale este webhook), a Órbita
 * nunca recebe vídeo contínuo. `webhookToken` autentica o POST — não é sessão
 * de usuário, é a câmera falando com a Órbita.
 */

export interface CameraEventInput {
  label: string;
  zone?: string | null;
  score?: number | null;
  /** data URL (image/jpeg;base64,...); descartada se maior que `cameras.snapshotMaxKB`. */
  snapshot?: string | null;
}

export async function cameraByToken(token: string): Promise<Camera | null> {
  const [c] = await db.select().from(camera).where(eq(camera.webhookToken, token)).limit(1);
  return c ?? null;
}

/** Tamanho aproximado em KB de uma data URL base64 (sem decodificar de verdade). */
export function dataUrlSizeKB(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.round((b64.length * 3) / 4 / 1024);
}

/**
 * Grava o evento e emite no event bus. Quem decide se isso é um alerta de
 * segurança é a REGRA que o dono cadastrar sobre `camera.detected` (condição
 * em `payload.label`), nunca o LLM — o caminho crítico de segurança não passa
 * por modelo nenhum.
 */
export async function ingestCameraEvent(cam: Camera, input: CameraEventInput): Promise<{ id: string }> {
  const [maxKB, narrationMode] = await Promise.all([settings.get("cameras.snapshotMaxKB"), settings.get("cameras.narrationMode")]);
  const snapshot = input.snapshot && dataUrlSizeKB(input.snapshot) <= maxKB ? input.snapshot : null;

  const [row] = await db
    .insert(cameraEvent)
    .values({ cameraId: cam.id, userId: cam.userId, label: input.label, zone: input.zone ?? null, score: input.score ?? null, snapshot })
    .returning({ id: cameraEvent.id });

  // "Automática" (cameras.narrationMode) é a exceção ao padrão sob demanda do
  // dono: narra aqui, fora do caminho de resposta do webhook, para não segurar
  // quem está chamando (o Frigate/script) esperando um VLM rodar.
  if (narrationMode === "automatica" && snapshot) {
    void narrateCameraEvent(row!.id).catch(() => {});
  }

  // Memória visual de objetos (Onda 11, decisão 9.4): "onde deixei a chave".
  // Só o que o dono listou, sem imagem e com prazo; o rótulo vem do próprio
  // detector da câmera. Não é biometria, então fica deste lado da cerca NV.1.
  void recordVisualObject({ id: row!.id, userId: cam.userId, cameraId: cam.id, roomId: cam.roomId, label: input.label, score: input.score ?? null, zone: input.zone ?? null }).catch((e) =>
    log.warn("vision.objeto_falhou", { cameraId: cam.id, error: e instanceof Error ? e.message : String(e) }),
  );

  let roomName: string | null = null;
  if (cam.roomId) {
    const [r] = await db.select({ name: room.name }).from(room).where(eq(room.id, cam.roomId)).limit(1);
    roomName = r?.name ?? null;
  }

  void events
    .emit(
      "camera.detected",
      {
        // `eventId` e as flags da câmera vão no payload porque quem identifica
        // rosto e gesto é um LISTENER deste evento (identity/camera-listener),
        // e não a ingestão: biometria não pode ser importada daqui (NV.1).
        eventId: row!.id,
        cameraId: cam.id,
        cameraName: cam.name,
        roomId: cam.roomId,
        roomName,
        label: input.label,
        zone: input.zone ?? null,
        score: input.score ?? null,
        comSnapshot: snapshot !== null,
        identificaPessoas: cam.identifyFaces,
        detectaGestos: cam.detectGestures,
      },
      { userId: cam.userId },
    )
    .catch(() => {});

  return { id: row!.id };
}
