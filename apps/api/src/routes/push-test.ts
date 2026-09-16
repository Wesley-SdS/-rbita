// Migrada do Next em paridade (apps/web/src/app/api/push/test/route.ts).
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { sendPush, pushEnabled } from "@orbita/core/push/send";

/** Envia um push de teste para o próprio usuário (botão "testar" na UI). */
export async function POST(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!pushEnabled()) return Response.json({ error: "Push não configurado (VAPID ausente)" }, { status: 503 });

  const r = await sendPush(session.user.id, {
    title: "ÓRBITA",
    body: "Notificações ativas — é assim que vou te avisar.",
    url: "/app",
  });
  return Response.json(r);
}
