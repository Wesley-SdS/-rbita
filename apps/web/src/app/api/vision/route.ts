import { generateText } from "ai";
import { z } from "zod";
import { resolveVisionModel } from "@orbita/llm";
import { getSession } from "@/lib/session";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  image: z.string().min(1), // data URL (image/png|jpeg)
  question: z.string().max(1000).default("O que você vê na tela? Como posso usar isso?"),
});

/** "Ver a tela": recebe um screenshot + pergunta e analisa com um modelo de visão. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });

  const { image, question } = parsed.data;
  try {
    const { text } = await generateText({
      model: resolveVisionModel(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question + " Responda em português do Brasil." },
            { type: "image", image },
          ],
        },
      ],
    });
    log.info("vision", { userId: session.user.id });
    return Response.json({ answer: text.trim() });
  } catch (e) {
    log.error("vision", { error: e instanceof Error ? e.message : String(e) });
    return Response.json(
      { error: "Modelo de visão indisponível. Baixe um no Ollama (ex.: `ollama pull moondream` ou `qwen2.5vl`) ou configure OPENAI_API_KEY." },
      { status: 502 },
    );
  }
}
