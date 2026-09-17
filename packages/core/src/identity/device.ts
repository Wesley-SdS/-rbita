import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@orbita/db";
import { device } from "@orbita/db/device-schema";
import { room } from "@orbita/db/home-schema";
import { pushSubscription } from "@orbita/db/push-schema";
import { personPresence } from "@orbita/db/presence-schema";
import { IdentityError } from "./errors";

/**
 * DISPOSITIVO ↔ CÔMODO (B5.3/B5.4, Onda 12). Fecha o "aqui": o pedido diz de
 * qual dispositivo veio, o dispositivo diz de qual cômodo, e as tools de casa
 * resolvem "apaga a luz daqui" sem adivinhação.
 *
 * Também é o que faz a voz SEGUIR A PESSOA: sabendo em que cômodo ela foi vista
 * (presença, Onda 10), a notificação vai para o dispositivo daquele cômodo.
 */

export const DeviceInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["navegador", "satelite", "celular"]).default("navegador"),
  roomId: z.string().uuid().nullable().default(null),
});

export async function registerDevice(ownerUserId: string, input: z.infer<typeof DeviceInputSchema>): Promise<{ id: string }> {
  if (input.roomId) {
    const [r] = await db.select({ id: room.id }).from(room).where(and(eq(room.id, input.roomId), eq(room.userId, ownerUserId))).limit(1);
    if (!r) throw new IdentityError("Cômodo não encontrado", 404);
  }
  const [row] = await db.insert(device).values({ userId: ownerUserId, name: input.name, kind: input.kind, roomId: input.roomId }).returning({ id: device.id });
  return { id: row!.id };
}

export async function updateDevice(ownerUserId: string, deviceId: string, patch: Partial<z.infer<typeof DeviceInputSchema>>): Promise<void> {
  if (patch.roomId) {
    const [r] = await db.select({ id: room.id }).from(room).where(and(eq(room.id, patch.roomId), eq(room.userId, ownerUserId))).limit(1);
    if (!r) throw new IdentityError("Cômodo não encontrado", 404);
  }
  const [row] = await db
    .update(device)
    .set({ ...patch })
    .where(and(eq(device.id, deviceId), eq(device.userId, ownerUserId)))
    .returning({ id: device.id });
  if (!row) throw new IdentityError("Dispositivo não encontrado", 404);
}

export async function removeDevice(ownerUserId: string, deviceId: string): Promise<void> {
  await db.delete(device).where(and(eq(device.id, deviceId), eq(device.userId, ownerUserId)));
}

export async function listDevices(ownerUserId: string) {
  return db
    .select({ id: device.id, name: device.name, kind: device.kind, roomId: device.roomId, roomName: room.name, lastSeenAt: device.lastSeenAt })
    .from(device)
    .leftJoin(room, eq(room.id, device.roomId))
    .where(eq(device.userId, ownerUserId))
    .orderBy(device.name);
}

export interface DeviceOrigin {
  deviceId: string;
  name: string;
  roomId: string | null;
  roomName: string | null;
}

/** De onde veio o pedido. Marca o dispositivo como visto agora (é o sinal de "está em uso"). */
export async function resolveOrigin(ownerUserId: string, deviceId: string | null | undefined): Promise<DeviceOrigin | null> {
  if (!deviceId) return null;
  const [d] = await db
    .select({ id: device.id, name: device.name, roomId: device.roomId, roomName: room.name })
    .from(device)
    .leftJoin(room, eq(room.id, device.roomId))
    .where(and(eq(device.id, deviceId), eq(device.userId, ownerUserId)))
    .limit(1);
  if (!d) return null;
  await db.update(device).set({ lastSeenAt: new Date() }).where(eq(device.id, d.id));
  return { deviceId: d.id, name: d.name, roomId: d.roomId, roomName: d.roomName };
}

/** Dispositivo mais recentemente usado num cômodo (para falar onde a pessoa está). */
export async function deviceInRoom(ownerUserId: string, roomId: string): Promise<{ id: string; name: string } | null> {
  const [d] = await db
    .select({ id: device.id, name: device.name })
    .from(device)
    .where(and(eq(device.userId, ownerUserId), eq(device.roomId, roomId)))
    .orderBy(desc(device.lastSeenAt))
    .limit(1);
  return d ?? null;
}

/**
 * A voz segue a pessoa (ID.1): o dispositivo do cômodo onde ela foi vista por
 * último. Sem presença recente ou sem dispositivo naquele cômodo, devolve null
 * e quem chamou cai no comportamento de sempre (avisar em todo lugar).
 */
export async function deviceForPerson(ownerUserId: string, personId: string): Promise<{ id: string; name: string; roomId: string } | null> {
  const [p] = await db
    .select({ roomId: personPresence.roomId })
    .from(personPresence)
    .where(and(eq(personPresence.userId, ownerUserId), eq(personPresence.personId, personId)))
    .limit(1);
  if (!p?.roomId) return null;
  const d = await deviceInRoom(ownerUserId, p.roomId);
  return d ? { ...d, roomId: p.roomId } : null;
}

/** Liga uma inscrição de push (navegador) ao dispositivo, para a notificação achar o cômodo. */
export async function linkPushToDevice(ownerUserId: string, endpoint: string, deviceId: string | null): Promise<void> {
  await db
    .update(pushSubscription)
    .set({ deviceId })
    .where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, ownerUserId)));
}
