// Migrada do Next em paridade (apps/web/src/app/api/routines/run/route.ts).
import { runDueRoutines } from "@orbita/core/routines/run";
import { rateLimit, tooMany } from "@orbita/core/ratelimit";
import { settings } from "@orbita/core/settings/index";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * Executa as rotinas devidas do usuário (botão "rodar agora") e cria notificações.
 * A lógica de execução vive em `runDueRoutines` (@orbita/core), a mesma que o
 * agendador do processo persistente usa; aqui só fica a borda HTTP.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const uid = session.user.id;

  // cada rotina devida roda generateText+tools (caro): limita as execuções manuais por minuto
  const limit = await settings.get("routines.rateLimitPerMinute");
  const rl = rateLimit(`routines:${uid}`, limit, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const { force } = (await req.json().catch(() => ({}))) as { force?: boolean };

  const { devidas, notificacoes } = await runDueRoutines(uid, { force });
  return Response.json({ devidas, notificacoes });
}
