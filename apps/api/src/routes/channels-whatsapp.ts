import { z } from "zod";
import { deleteWhatsappConnection, getWhatsappCreds, saveWhatsappConnection } from "@orbita/core/connectors/whatsapp";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

const Body = z.object({ phoneId: z.string().min(1).max(60), token: z.string().min(10).max(4000) });

/** GET /api/channels/whatsapp — status (sem devolver o token). */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const creds = await getWhatsappCreds(session.user.id);
  return Response.json({ configured: creds !== null, phoneId: creds?.phoneId ?? null });
}

/** POST /api/channels/whatsapp — cadastra token + phone id (CH.2, zero hardcode). */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  await saveWhatsappConnection(session.user.id, parsed.data.phoneId, parsed.data.token);
  return Response.json({ ok: true });
}

/** DELETE /api/channels/whatsapp — remove o cadastro (volta a valer só o .env, se houver). */
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  await deleteWhatsappConnection(session.user.id);
  return Response.json({ ok: true });
}
