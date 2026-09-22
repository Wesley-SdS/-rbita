import { z } from "zod";
import { runRealtimeTool } from "@orbita/core/tools/index";
import { requesterResolver } from "@orbita/core/identity/requester";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { log } from "@orbita/core/observability/logger";

const Body = z.object({ name: z.string().min(1).max(80), arguments: z.unknown(), deviceId: z.string().uuid().optional() });

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
  // sem trecho de voz aqui (o áudio vai direto à OpenAI por WebRTC): vale a conta,
  // mas a permissão por pessoa e cômodo do registro continua sendo aplicada
  const quem = requesterResolver(session.user.id, null, parsed.data.deviceId ?? null);
  const result = await runRealtimeTool(session.user.id, parsed.data.name, parsed.data.arguments, quem.resolve, quem.origin);
  // o NOME da tool no log: sem ele, "POST /api/realtime/tool 200" não diz nada
  // e diagnosticar uma conversa por voz vira adivinhação
  log.info("realtime.tool", { userId: session.user.id, tool: parsed.data.name });
  return Response.json({ result });
}
