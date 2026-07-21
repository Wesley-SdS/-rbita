import { z } from "zod";
import { getSession } from "@/lib/session";
import { geminiTtsAvailable, synthesizeGemini } from "@/lib/voice/tts-gemini";
import { EDGE_MIME, edgeTtsAvailable, synthesizeEdge } from "@/lib/voice/tts-edge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ text: z.string().min(1).max(2000), length_scale: z.number().min(0.5).max(2).optional() });

const semCache = { "Cache-Control": "no-store" } as const;
const audio = (buf: Buffer, mime: string) =>
  new Response(new Uint8Array(buf), { headers: { "Content-Type": mime, ...semCache } });

/** Piper, no serviço de voz Python (último recurso / modo totalmente offline). */
async function piper(payload: unknown): Promise<Response> {
  const url = (process.env.VOICE_URL ?? "http://localhost:8001") + "/tts";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return Response.json({ error: "TTS falhou" }, { status: res.status });
    return new Response(await res.arrayBuffer(), { headers: { "Content-Type": "audio/wav", ...semCache } });
  } catch {
    return Response.json({ error: "Serviço de voz indisponível" }, { status: 503 });
  }
}

/**
 * Sintetiza a fala da Órbita.
 *
 * Cadeia: Edge (voz Vivienne, grátis e rápida) → Gemini (Sulafat, se houver
 * chave e cota) → Piper (local, robótico mas sempre disponível). Cada degrau só
 * é usado se o anterior falhar, então uma indisponibilidade não emudece a Órbita.
 *
 * `TTS_PROVIDER` fixa um provedor: `edge` | `gemini` | `piper` (padrão `auto`).
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });

  const provider = process.env.TTS_PROVIDER ?? "auto";
  const texto = parsed.data.text;
  const fixo = provider !== "auto";

  if ((provider === "auto" || provider === "edge") && edgeTtsAvailable()) {
    try {
      return audio(await synthesizeEdge(texto, req.signal), EDGE_MIME);
    } catch (e) {
      if (req.signal.aborted) return new Response(null, { status: 499 }); // barge-in
      console.error("[tts] edge falhou:", e instanceof Error ? e.message : e);
      if (fixo) return Response.json({ error: "TTS falhou" }, { status: 502 });
    }
  }

  if ((provider === "auto" || provider === "gemini") && geminiTtsAvailable()) {
    try {
      return audio(await synthesizeGemini(texto, req.signal), "audio/wav");
    } catch (e) {
      if (req.signal.aborted) return new Response(null, { status: 499 });
      // cota estourada (10/dia no free) ou API fora: cai para o Piper
      console.error("[tts] gemini falhou:", e instanceof Error ? e.message : e);
      if (fixo) return Response.json({ error: "TTS falhou" }, { status: 502 });
    }
  }

  return piper(parsed.data);
}
