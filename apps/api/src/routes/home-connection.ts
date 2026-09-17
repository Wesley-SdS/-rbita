import { z } from "zod";
import { deleteHaConnection, getHaConnection, saveHaConnection, HomeAssistantError } from "@orbita/core/home/connection";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

const Body = z.object({
  baseUrl: z.string().url().max(300),
  token: z.string().min(10).max(4000),
});

/** GET /api/home/connection — status (sem devolver o token). */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const conn = await getHaConnection(session.user.id);
  return Response.json({ connected: conn !== null, baseUrl: conn?.baseUrl ?? null });
}

/** POST /api/home/connection — cadastra (testa a conexão antes de salvar). */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const { label } = await saveHaConnection(session.user.id, parsed.data.baseUrl, parsed.data.token);
    return Response.json({ ok: true, label });
  } catch (e) {
    const msg = e instanceof HomeAssistantError ? e.message : e instanceof Error ? e.message : "Falha ao conectar";
    return Response.json({ error: msg }, { status: 502 });
  }
}

/** DELETE /api/home/connection — desconecta. */
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  await deleteHaConnection(session.user.id);
  return Response.json({ ok: true });
}
