import { asc, gt, lt, max } from "drizzle-orm";
import { db } from "@orbita/db";
import { eventLog } from "@orbita/db/event-schema";
import { createEventBus, type EventBus, type OrbitaEvent } from "./bus";

export * from "./bus";

/** Persistência real: uma linha em `event_log`. */
export async function persistEvent(ev: OrbitaEvent): Promise<number | undefined> {
  const [row] = await db
    .insert(eventLog)
    .values({ type: ev.type, userId: ev.userId ?? null, source: ev.source, payload: ev.payload, createdAt: ev.at })
    .returning({ id: eventLog.id });
  return row?.id;
}

/** Eventos gravados depois de `afterId` (outbox), em ordem. */
export async function fetchEventsAfter(afterId: number, limit = 200): Promise<OrbitaEvent[]> {
  const rows = await db.select().from(eventLog).where(gt(eventLog.id, afterId)).orderBy(asc(eventLog.id)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    userId: r.userId,
    source: r.source,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    at: r.createdAt,
  }));
}

/** Maior id já gravado (ponto de partida do poller: não reprocessa o passado). */
export async function latestEventId(): Promise<number> {
  const [row] = await db.select({ id: max(eventLog.id) }).from(eventLog);
  return Number(row?.id ?? 0);
}

/** Apaga eventos mais antigos que `days` (retenção configurável). */
export async function pruneEvents(days: number): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  await db.delete(eventLog).where(lt(eventLog.createdAt, cutoff));
}

/**
 * Bus do processo atual. O `source` identifica quem emitiu na trilha; cada app
 * chama `configureEventSource()` no boot (o default "web" serve ao Next).
 */
let sourceName = "web";
export function configureEventSource(name: string) {
  sourceName = name;
}
export const events: EventBus = createEventBus({
  get source() {
    return sourceName;
  },
  persist: persistEvent,
});
