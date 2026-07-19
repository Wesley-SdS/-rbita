import { getSession } from "@/lib/session";
import { sendPush, pushEnabled } from "@/lib/push/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Envia um push de teste para o próprio usuário (botão "testar" na UI). */
export async function POST() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!pushEnabled()) return Response.json({ error: "Push não configurado (VAPID ausente)" }, { status: 503 });

  const r = await sendPush(session.user.id, {
    title: "ÓRBITA",
    body: "Notificações ativas — é assim que vou te avisar.",
    url: "/app",
  });
  return Response.json(r);
}
