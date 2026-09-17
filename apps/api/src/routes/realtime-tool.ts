import { z } from "zod";
import { runRealtimeTool } from "@orbita/core/tools/index";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

const Body = z.object({ name: z.string().min(1).max(80), arguments: z.unknown() });

/**
 * POST /api/realtime/tool — o browser nunca executa uma tool sozinho durante
 * a sessão de voz (WebRTC é direto com a OpenAI, não passa pelo nosso
 * backend): quando o modelo pede uma function call, o cliente repassa
 * nome+argumentos para cá, que roda pelo MESMO registro/gate do chat de
 * texto (`runRealtimeTool`, Onda 6 B7.2).
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const result = await runRealtimeTool(session.user.id, parsed.data.name, parsed.data.arguments);
  return Response.json({ result });
}
