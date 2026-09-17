import { asc, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@orbita/db";
import { eventLog } from "@orbita/db/event-schema";
import { createEventBus, type EventBus, type OrbitaEvent } from "./bus";

export * from "./bus";

/**
 * Persistência real: uma linha em `event_log`. Evento emitido DENTRO do apps/api
 * (source "api") já é despachado às regras em processo, então nasce processado;
 * os demais ficam pendentes até o poller do apps/api despachar (RV.5).
 */
export async function persistEvent(ev: OrbitaEvent): Promise<number | undefined> {
  const [row] = await db
    .insert(eventLog)
    .values({ type: ev.type, userId: ev.userId ?? null, source: ev.source, payload: ev.payload, createdAt: ev.at, processedAt: ev.source === "api" ? ev.at : null })
    .returning({ id: eventLog.id });
  return row?.id;
}

/** Eventos ainda não despachados às regras, do mais antigo ao mais novo (RV.5). */
export async function fetchPendingEvents(limit = 200): Promise<OrbitaEvent[]> {
  const rows = await db.select().from(eventLog).where(isNull(eventLog.processedAt)).orderBy(asc(eventLog.id)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    userId: r.userId,
    source: r.source,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    at: r.createdAt,
  }));
}

/** Marca como despachados (um de cada vez no poller: queda no meio não repete os já feitos). */
export async function markEventsProcessed(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db.update(eventLog).set({ processedAt: new Date() }).where(inArray(eventLog.id, ids));
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
