import { and, desc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { person, room } from "@orbita/db/home-schema";
import { personPresence } from "@orbita/db/presence-schema";
import { settings } from "../settings";
import { events } from "../events/index";

/**
 * PRESENÇA por cômodo (decisão 9.3). Regra pura à parte para a idade do dado
 * ser visível: presença velha não é presença, é "visto por último".
 */

export type PresenceFreshness = "agora" | "recente" | "antigo";

/** Quão confiável é este avistamento agora? Puro. */
export function freshness(seenAt: Date, now: Date, frescoMin: number, recenteMin: number): PresenceFreshness {
  const min = (now.getTime() - seenAt.getTime()) / 60_000;
  if (min <= frescoMin) return "agora";
  if (min <= recenteMin) return "recente";
  return "antigo";
}

export interface PresenceRow {
  personId: string;
  name: string;
  roomId: string | null;
  roomName: string | null;
  source: string;
  confidence: number | null;
  seenAt: Date;
  quando: PresenceFreshness;
}

/** Registra onde a pessoa foi vista. Só troca de cômodo emite evento (evita enxurrada). */
export async function updatePresence(ownerUserId: string, personId: string, roomId: string | null, source: string, confidence: number | null): Promise<{ mudou: boolean }> {
  const [antes] = await db
    .select({ roomId: personPresence.roomId })
    .from(personPresence)
    .where(and(eq(personPresence.userId, ownerUserId), eq(personPresence.personId, personId)))
    .limit(1);
  const agora = new Date();
  await db
    .insert(personPresence)
    .values({ userId: ownerUserId, personId, roomId, source, confidence, seenAt: agora })
    .onConflictDoUpdate({ target: [personPresence.userId, personPresence.personId], set: { roomId, source, confidence, seenAt: agora } });

  const mudou = !antes || antes.roomId !== roomId;
  if (mudou) {
    await events.emit("identity.presence_changed", { personId, roomId, de: antes?.roomId ?? null, source }, { userId: ownerUserId }).catch(() => undefined);
  }
  return { mudou };
}

/** Quem está onde, com a idade do avistamento (a UI e as tools mostram isso, nunca afirmam sozinhas). */
export async function currentPresence(ownerUserId: string): Promise<PresenceRow[]> {
  const cfg = await settings.getMany(["identity.presenceFreshMinutes", "identity.presenceRecentMinutes"]);
  const rows = await db
    .select({
      personId: personPresence.personId,
      name: person.name,
      roomId: personPresence.roomId,
      roomName: room.name,
      source: personPresence.source,
      confidence: personPresence.confidence,
      seenAt: personPresence.seenAt,
    })
    .from(personPresence)
    .innerJoin(person, eq(person.id, personPresence.personId))
    .leftJoin(room, eq(room.id, personPresence.roomId))
    .where(eq(personPresence.userId, ownerUserId))
    .orderBy(desc(personPresence.seenAt));
  const agora = new Date();
  return rows.map((r) => ({ ...r, quando: freshness(r.seenAt, agora, cfg["identity.presenceFreshMinutes"], cfg["identity.presenceRecentMinutes"]) }));
}

/** Cômodo onde a pessoa está agora, só se o avistamento for recente o bastante. */
export async function roomOf(ownerUserId: string, personId: string): Promise<{ roomId: string | null; quando: PresenceFreshness } | null> {
  const atual = (await currentPresence(ownerUserId)).find((p) => p.personId === personId);
  return atual ? { roomId: atual.roomId, quando: atual.quando } : null;
}
