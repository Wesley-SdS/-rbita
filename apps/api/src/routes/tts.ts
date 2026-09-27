// Migrada do Next em paridade (apps/web/src/app/api/tts/route.ts).
import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { FalaError, sintetizarFala } from "@orbita/core/voice/sintetizar";

const Body = z.object({ text: z.string().min(1).max(2000), length_scale: z.number().min(0.5).max(2).optional() });

const semCache = { "Cache-Control": "no-store" } as const;

/**
 * Sintetiza a fala da Órbita. A cadeia (Edge → Gemini → Piper) e a conta moram
 * em `core/voice/sintetizar.ts`, onde a nota de voz do WhatsApp também as usa.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });

  try {
    const fala = await sintetizarFala(parsed.data.text, { userId: session.user.id, signal: req.signal, lengthScale: parsed.data.length_scale });
    return new Response(new Uint8Array(fala.bytes), { headers: { "Content-Type": fala.mime, ...semCache } });
  } catch (e) {
    if (e instanceof FalaError) {
      if (e.status === 499) return new Response(null, { status: 499 }); // barge-in
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json({ error: "TTS falhou" }, { status: 502 });
  }
}
