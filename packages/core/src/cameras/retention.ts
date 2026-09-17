import { lt } from "drizzle-orm";
import { db } from "@orbita/db";
import { cameraEvent } from "@orbita/db/camera-schema";

/** Política de retenção (briefing §7.1: "câmera 24/7 exige... política de retenção"). */
export async function purgeOldCameraEvents(days: number): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  await db.delete(cameraEvent).where(lt(cameraEvent.createdAt, cutoff));
}
