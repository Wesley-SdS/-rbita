// Migrada do Next em paridade (apps/web/src/app/api/realtime/config/route.ts).
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/** Diz à UI se o modo tempo real (S2S premium) está configurado no servidor. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const enabled = Boolean(process.env.OPENAI_API_KEY);
  // Estável por sessão (só depende do env) → cache no navegador evita re-fetch a cada mount.
  return Response.json(
    { enabled, provider: enabled ? "openai-realtime" : null },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
