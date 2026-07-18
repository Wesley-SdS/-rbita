import { getSession } from "@/lib/session";
import { SYSTEM_PROMPT } from "@/lib/chat/tools";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cria uma sessão efêmera da OpenAI Realtime (S2S premium). O token de curta
 * duração (client_secret) volta para o browser, que abre o WebRTC direto com a
 * OpenAI — a chave real (OPENAI_API_KEY) nunca sai do servidor.
 * Só funciona se OPENAI_API_KEY estiver configurada (senão o modo some da UI).
 */
export async function POST() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "Modo tempo real não configurado (falta OPENAI_API_KEY)" }, { status: 400 });

  const model = process.env.REALTIME_MODEL ?? "gpt-realtime";
  const voice = process.env.REALTIME_VOICE ?? "marin";

  try {
    // API atual (2026): cria um client secret efêmero com a config da sessão.
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          audio: { output: { voice } },
          instructions:
            SYSTEM_PROMPT +
            " Você está em conversa por voz em tempo real: fale de forma natural, breve e calorosa, em português do Brasil.",
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      log.error("realtime.session", { status: res.status, detail: detail.slice(0, 200) });
      return Response.json({ error: "Falha ao abrir sessão realtime" }, { status: 502 });
    }
    // resposta: { value: "ek_...", expires_at, session: {...} }
    const data = (await res.json()) as { value?: string; expires_at?: number };
    if (!data.value) return Response.json({ error: "Sessão sem token" }, { status: 502 });

    log.info("realtime.session", { userId: session.user.id, model });
    return Response.json({ clientSecret: data.value, model, voice, expiresAt: data.expires_at });
  } catch (e) {
    log.error("realtime.session", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Erro ao contatar a OpenAI Realtime" }, { status: 502 });
  }
}
