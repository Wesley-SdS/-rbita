import { z } from "zod";
import { eventBelongsToUser, recentEvents } from "@orbita/core/cameras/query";
import { narrateCameraEvent } from "@orbita/core/cameras/narrate";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

const CameraIdQuery = z.string().uuid();

/** GET /api/cameras/events?cameraId=... (opcional) — mais recentes primeiro, com a narração se já foi pedida. */
export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const raw = new URL(req.url).searchParams.get("cameraId");
  if (raw !== null && !CameraIdQuery.safeParse(raw).success) return Response.json({ error: "cameraId inválido" }, { status: 400 });
  const rows = await recentEvents(session.user.id, raw);
  return Response.json({ events: rows });
}

const NarrateBody = z.object({ eventId: z.string().uuid() });

/** POST /api/cameras/events — narra UM evento sob demanda (nunca automático). */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = NarrateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  // confere que o evento é do próprio usuário sem trazer o snapshot inteiro
  // (narrateCameraEvent lê por id direto; esta checagem evita narrar evento de outro dono).
  if (!(await eventBelongsToUser(session.user.id, parsed.data.eventId))) return Response.json({ error: "Evento não encontrado" }, { status: 404 });

  try {
    const narration = await narrateCameraEvent(parsed.data.eventId);
    return Response.json({ narration });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Falha ao narrar" }, { status: 502 });
  }
}
