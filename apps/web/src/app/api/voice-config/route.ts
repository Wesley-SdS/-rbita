import { getSession } from "@/lib/session";
import { voiceServiceUrl } from "@/lib/voice/service-url";

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

  // URL pública do WS de wake p/ o browser. Trim + validação: um valor malformado
  // (ex.: rótulo colado junto) não pode virar uma wsWakeUrl quebrada no cliente.
  const wsRaw = (process.env.VOICE_PUBLIC_WS_URL ?? "ws://localhost:8001").trim();
  let wsBase: string | null = null;
  try {
    const u = new URL(wsRaw);
    if (u.protocol === "ws:" || u.protocol === "wss:") wsBase = `${u.protocol}//${u.host}`;
  } catch {
    /* malformado → wsBase null, wake indisponível */
  }

  const httpBase = voiceServiceUrl(); // valida VOICE_URL (null se inutilizável)

  let up = false;
  let wakePhrase = "Ei Órbita";
  if (httpBase && wsBase) {
    try {
      const res = await fetch(httpBase + "/health", { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        up = true;
        const h = await res.json().catch(() => ({}));
        wakePhrase = h.wake_phrase ?? wakePhrase;
      }
    } catch {
      up = false;
    }
  }

  // cache curtinho: evita martelar o /health do voice, mas reflete rápido quando ele sobe.
  return Response.json(
    { up, wsWakeUrl: wsBase ? `${wsBase}/ws/wake` : null, wakePhrase },
    { headers: { "Cache-Control": "private, max-age=10" } },
  );
}
