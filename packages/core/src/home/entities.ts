import { and, cosineDistance, eq, gt, sql } from "drizzle-orm";
import { embedText, embedTexts } from "@orbita/llm";
import { db } from "@orbita/db";
import { haEntity } from "@orbita/db/home-schema";
import { listStates, type HaState } from "./client";
import { domainOf } from "./domain-risk";
import { settings } from "../settings";
import { log } from "../observability/logger";

/** Texto que vira o embedding da entidade: nome + domínio, é o que a busca compara. */
export function embedTextFor(state: HaState): string {
  const name = state.attributes.friendly_name ?? state.entity_id;
  return `${name} (${domainOf(state.entity_id)})`;
}

/**
 * Sincroniza as entidades do HA para o índice local (B3.6). Upsert por
 * `entity_id`: reembeda só quando nome/domínio mudam (o resto é troca de
 * estado, barata, não precisa de embedding novo).
 */
export async function syncEntities(userId: string, baseUrl: string, token: string): Promise<{ total: number; reembedded: number }> {
  const states = await listStates(baseUrl, token);
  const existing = await db.select().from(haEntity).where(eq(haEntity.userId, userId));
  const byEntityId = new Map(existing.map((e) => [e.entityId, e]));

  let reembedded = 0;
  const toEmbed: { state: HaState; text: string }[] = [];
  for (const s of states) {
    const prev = byEntityId.get(s.entity_id);
    const name = s.attributes.friendly_name ?? s.entity_id;
    if (!prev || prev.friendlyName !== name || !prev.embedding) {
      toEmbed.push({ state: s, text: embedTextFor(s) });
    }
  }

  const embeddings = toEmbed.length ? await embedTexts(toEmbed.map((t) => t.text)) : [];
  const embeddingByEntityId = new Map(toEmbed.map((t, i) => [t.state.entity_id, embeddings[i]]));

  for (const s of states) {
    const embedding = embeddingByEntityId.get(s.entity_id);
    const values = {
      userId,
      entityId: s.entity_id,
      domain: domainOf(s.entity_id),
      friendlyName: s.attributes.friendly_name ?? s.entity_id,
      lastState: { state: s.state, attributes: s.attributes },
      lastChangedAt: s.last_changed ? new Date(s.last_changed) : null,
      updatedAt: new Date(),
      ...(embedding ? { embedding } : {}),
    };
    await db
      .insert(haEntity)
      .values(values)
      .onConflictDoUpdate({ target: [haEntity.userId, haEntity.entityId], set: values });
    if (embedding) reembedded++;
  }

  log.info("home.entities_synced", { userId, total: states.length, reembedded });
  return { total: states.length, reembedded };
}

export interface EntityHit {
  entityId: string;
  domain: string;
  friendlyName: string;
  roomId: string | null;
  state: string | null;
  sim: number;
}

/** Busca semântica: "a luz da sala" → as entidades mais parecidas. */
export async function findEntities(userId: string, query: string, k?: number): Promise<EntityHit[]> {
  const cfg = await settings.getMany(["home.entityTopK", "home.entityMinSim"]);
  const limit = k ?? cfg["home.entityTopK"];
  const q = await embedText(query, "query");
  const sim = sql<number>`1 - (${cosineDistance(haEntity.embedding, q)})`;
  const rows = await db
    .select({ entityId: haEntity.entityId, domain: haEntity.domain, friendlyName: haEntity.friendlyName, roomId: haEntity.roomId, lastState: haEntity.lastState, sim })
    .from(haEntity)
    .where(and(eq(haEntity.userId, userId), gt(sim, cfg["home.entityMinSim"])))
    .orderBy(sql`${sim} desc`)
    .limit(limit);
  return rows.map((r) => ({
    entityId: r.entityId,
    domain: r.domain,
    friendlyName: r.friendlyName,
    roomId: r.roomId,
    state: (r.lastState as { state?: string } | null)?.state ?? null,
    sim: Number(r.sim),
  }));
}

/** Entidades de um cômodo (para "apaga tudo da sala"). */
export async function entitiesInRoom(userId: string, roomId: string): Promise<EntityHit[]> {
  const rows = await db.select().from(haEntity).where(and(eq(haEntity.userId, userId), eq(haEntity.roomId, roomId)));
  return rows.map((r) => ({
    entityId: r.entityId,
    domain: r.domain,
    friendlyName: r.friendlyName,
    roomId: r.roomId,
    state: (r.lastState as { state?: string } | null)?.state ?? null,
    sim: 1,
  }));
}
