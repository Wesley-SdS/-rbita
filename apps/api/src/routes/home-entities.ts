import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { haEntity } from "@orbita/db/home-schema";
import { getHaConnection } from "@orbita/core/home/connection";
import { syncEntities } from "@orbita/core/home/entities";
import { HomeAssistantError } from "@orbita/core/home/client";
import type { RouteCtx } from "../http/web";
import { leituraCacheavel } from "../http/cacheable";
import { sessionOf } from "../http/web-route";

/** GET /api/home/entities — o índice local (não vai à rede; a sincronização é o scheduler ou POST abaixo). */
export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db.select().from(haEntity).where(eq(haEntity.userId, session.user.id));
  return leituraCacheavel(req, {
    entities: rows.map((r) => ({
      entityId: r.entityId, domain: r.domain, friendlyName: r.friendlyName, roomId: r.roomId,
      state: (r.lastState as { state?: string } | null)?.state ?? null, updatedAt: r.updatedAt,
    })),
  });
}

/** POST /api/home/entities — força uma sincronização agora (botão "atualizar"). */
export async function POST(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const conn = await getHaConnection(session.user.id);
  if (!conn) return Response.json({ error: "Home Assistant não conectado" }, { status: 400 });
  try {
    const r = await syncEntities(session.user.id, conn.baseUrl, conn.token);
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: e instanceof HomeAssistantError ? e.message : "Falha ao sincronizar" }, { status: 502 });
  }
}

const PatchBody = z.object({ entityId: z.string().min(1).max(200), roomId: z.string().uuid().nullable() });

/** PATCH /api/home/entities — associa (ou remove) o cômodo de uma entidade. */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  await db
    .update(haEntity)
    .set({ roomId: parsed.data.roomId })
    .where(and(eq(haEntity.userId, session.user.id), eq(haEntity.entityId, parsed.data.entityId)));
  return Response.json({ ok: true });
}
