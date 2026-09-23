// Migrada do Next em paridade (apps/web/src/app/api/voice-config/route.ts).
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { voiceServiceUrl } from "@orbita/core/voice/service-url";
import { settings } from "@orbita/core/settings/index";

/**
 * Config pública do serviço de voz para o cliente:
 * - wsWakeUrl: WebSocket de wake word (o browser conecta direto no serviço).
 * - ttsEnabled/wakeEnabled: se o serviço está acessível.
 * O WS não passa por proxy do Next; o cliente precisa da URL pública do voice.
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
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

  // O motor e as frases são do dono (§5.6). O navegador não pode repetir essa
  // decisão em constante: mudar na tela e o wake continuar igual seria pior do
  // que não ter a opção.
  const cfg = await settings.getMany(["voice.wakeEngine", "voice.wakePhrases", "voice.vadModo", "voice.silencioMs", "voice.minFalaMs", "voice.maxFalaMs"]);

  // cache curtinho: evita martelar o /health do voice, mas reflete rápido quando ele sobe.
  return Response.json(
    {
      up,
      wsWakeUrl: wsBase ? `${wsBase}/ws/wake` : null,
      wakePhrase,
      motor: cfg["voice.wakeEngine"],
      frases: cfg["voice.wakePhrases"],
      // como decidir que a pessoa parou de falar. O navegador NÃO repete isto
      // em constante: o limiar era 0,02 cravado no código e não havia como
      // ajustar para um cômodo barulhento.
      vad: {
        modo: cfg["voice.vadModo"],
        silencioMs: cfg["voice.silencioMs"],
        minFalaMs: cfg["voice.minFalaMs"],
        maxMs: cfg["voice.maxFalaMs"],
      },
    },
    { headers: { "Cache-Control": "private, max-age=10" } },
  );
}
