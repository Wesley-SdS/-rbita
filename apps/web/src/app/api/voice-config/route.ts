import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Config pública do serviço de voz para o cliente:
 * - wsWakeUrl: WebSocket de wake word (o browser conecta direto no serviço).
 * - ttsEnabled/wakeEnabled: se o serviço está acessível.
 * O WS não passa por proxy do Next; o cliente precisa da URL pública do voice.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  // URL pública do voice para o browser. Em dev/compose, localhost:8001.
  const wsBase = process.env.VOICE_PUBLIC_WS_URL ?? "ws://localhost:8001";
  const httpBase = process.env.VOICE_URL ?? "http://localhost:8001";

  let up = false;
  let wakeModel = "hey_jarvis";
  try {
    const res = await fetch(httpBase + "/health", { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      up = true;
      const h = await res.json().catch(() => ({}));
      wakeModel = h.wake_model ?? wakeModel;
    }
  } catch {
    up = false;
  }

  return Response.json({ up, wsWakeUrl: `${wsBase}/ws/wake`, wakeModel });
}
