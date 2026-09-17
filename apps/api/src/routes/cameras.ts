import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@orbita/db";
import { camera } from "@orbita/db/camera-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

const CreateBody = z.object({ name: z.string().min(1).max(60), roomId: z.string().uuid().nullable().optional() });
const PatchBody = z.object({ name: z.string().min(1).max(60).optional(), roomId: z.string().uuid().nullable().optional(), enabled: z.boolean().optional() });

/** GET /api/cameras — nunca devolve o webhookToken de volta (só na criação). */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select({ id: camera.id, name: camera.name, roomId: camera.roomId, enabled: camera.enabled, provider: camera.provider, createdAt: camera.createdAt })
    .from(camera)
    .where(eq(camera.userId, session.user.id));
  return Response.json({ cameras: rows });
}

/**
 * POST /api/cameras — cadastra a câmera e gera o token do webhook (B do
 * briefing §7.1: sem lista fixa de câmera no código, tudo pela tela). O token
 * só é mostrado nesta resposta; o dono cola no Frigate/script que vai postar
 * os eventos em POST /api/cameras/ingest.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const webhookToken = randomBytes(24).toString("hex");
  const [row] = await db
    .insert(camera)
    .values({ userId: session.user.id, name: parsed.data.name, roomId: parsed.data.roomId ?? null, webhookToken })
    .returning({ id: camera.id });
  return Response.json({ id: row?.id, webhookToken });
}

/** PATCH /api/cameras?id=... — nome, cômodo, ou ligar/desligar (o opt-out por cômodo). */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  if (Object.keys(parsed.data).length === 0) return Response.json({ error: "Nada para atualizar" }, { status: 400 });
  await db
    .update(camera)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(camera.id, id), eq(camera.userId, session.user.id)));
  return Response.json({ ok: true });
}

/** DELETE /api/cameras?id=... */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(camera).where(and(eq(camera.id, id), eq(camera.userId, session.user.id)));
  return Response.json({ ok: true });
}
