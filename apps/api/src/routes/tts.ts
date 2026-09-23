// Migrada do Next em paridade (apps/web/src/app/api/tts/route.ts).
import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { geminiTtsAvailable, synthesizeGemini } from "@orbita/core/voice/tts-gemini";
import { EDGE_MIME, edgeTtsAvailable, synthesizeEdge } from "@orbita/core/voice/tts-edge";
import { voiceServiceUrl } from "@orbita/core/voice/service-url";
import { FLUXO, registrarUso } from "@orbita/core/usage/registrar";

const Body = z.object({ text: z.string().min(1).max(2000), length_scale: z.number().min(0.5).max(2).optional() });

const semCache = { "Cache-Control": "no-store" } as const;
const audio = (buf: Buffer, mime: string) =>
  new Response(new Uint8Array(buf), { headers: { "Content-Type": mime, ...semCache } });

/**
 * Registra a fala na conta da casa.
 *
 * O Edge e o Piper saem de graça, e é justamente por isso que precisam de
 * linha: sem elas, "a Órbita falou 900 vezes este mês sem custo" fica
 * indistinguível de "ninguém mediu a fala". Quando a cadeia cai para o Gemini
 * (que cobra), a diferença aparece sozinha na tela.
 */
function registrarFala(userId: string, servico: string, texto: string, comecou: number, erro?: string): void {
  registrarUso({
    userId,
    fluxo: FLUXO.tts,
    servico,
    consumo: { unidade: "caracteres", entrada: 0, saida: texto.length },
    duracaoMs: Date.now() - comecou,
    erro: erro ?? null,
  });
}

/** Piper, no serviço de voz Python (último recurso / modo totalmente offline). */
async function piper(payload: unknown): Promise<Response> {
  const base = voiceServiceUrl();
  if (!base) return Response.json({ error: "Serviço de voz indisponível" }, { status: 503 });
  const url = base + "/tts";
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
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });

  const provider = process.env.TTS_PROVIDER ?? "auto";
  const texto = parsed.data.text;
  const fixo = provider !== "auto";
  const userId = session.user.id;
  const comecou = Date.now();

  if ((provider === "auto" || provider === "edge") && edgeTtsAvailable()) {
    try {
      const wav = audio(await synthesizeEdge(texto, req.signal), EDGE_MIME);
      registrarFala(userId, "edge-tts", texto, comecou);
      return wav;
    } catch (e) {
      if (req.signal.aborted) return new Response(null, { status: 499 }); // barge-in
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[tts] edge falhou:", msg);
      // a falha também vira linha: é ela que explica por que o mês seguinte
      // veio mais caro (a cadeia caiu para um degrau pago)
      registrarFala(userId, "edge-tts", texto, comecou, msg.slice(0, 200));
      if (fixo) return Response.json({ error: "TTS falhou" }, { status: 502 });
    }
  }

  if ((provider === "auto" || provider === "gemini") && geminiTtsAvailable()) {
    try {
      const wav = audio(await synthesizeGemini(texto, req.signal), "audio/wav");
      registrarFala(userId, "gemini-tts", texto, comecou);
      return wav;
    } catch (e) {
      if (req.signal.aborted) return new Response(null, { status: 499 });
      // cota estourada (10/dia no free) ou API fora: cai para o Piper
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[tts] gemini falhou:", msg);
      registrarFala(userId, "gemini-tts", texto, comecou, msg.slice(0, 200));
      if (fixo) return Response.json({ error: "TTS falhou" }, { status: 502 });
    }
  }

  const res = await piper(parsed.data);
  registrarFala(userId, "piper", texto, comecou, res.ok ? undefined : "piper_indisponivel");
  return res;
}
