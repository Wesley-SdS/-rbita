import { z } from "zod";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ text: z.string().min(1).max(2000), length_scale: z.number().min(0.5).max(2).optional() });

/** Proxy para o TTS local (Piper) do serviço de voz. Retorna WAV. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });

  const url = (process.env.VOICE_URL ?? "http://localhost:8001") + "/tts";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    if (!res.ok) return Response.json({ error: "TTS falhou" }, { status: res.status });
    const buf = await res.arrayBuffer();
    return new Response(buf, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Serviço de voz indisponível" }, { status: 503 });
  }
}
