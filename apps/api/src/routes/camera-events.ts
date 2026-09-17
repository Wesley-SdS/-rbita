import { z } from "zod";
import { recentEvents } from "@orbita/core/cameras/query";
import { narrateCameraEvent } from "@orbita/core/cameras/narrate";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/** GET /api/cameras/events?cameraId=... (opcional) — mais recentes primeiro, com a narração se já foi pedida. */
export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const cameraId = new URL(req.url).searchParams.get("cameraId");
  const rows = await recentEvents(session.user.id, cameraId);
  return Response.json({ events: rows });
}

const NarrateBody = z.object({ eventId: z.string().uuid() });

/** POST /api/cameras/events — narra UM evento sob demanda (nunca automático). */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = NarrateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  // confere que o evento é de uma câmera do próprio usuário (recentEvents já filtra por userId,
  // mas narrateCameraEvent lê por id direto; a checagem aqui evita narrar evento de outro dono).
  const rows = await recentEvents(session.user.id, null, 200);
  if (!rows.some((e) => e.id === parsed.data.eventId)) return Response.json({ error: "Evento não encontrado" }, { status: 404 });

  try {
    const narration = await narrateCameraEvent(parsed.data.eventId);
    return Response.json({ narration });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Falha ao narrar" }, { status: 502 });
  }
}
