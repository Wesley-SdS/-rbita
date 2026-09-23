// Migrada do Next em paridade (apps/web/src/app/api/vision/route.ts).
import { generateText } from "ai";
import { z } from "zod";
import { resolveVisionModel } from "@orbita/llm";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { log } from "@orbita/core/observability/logger";
import { FLUXO, registrarUso } from "@orbita/core/usage/registrar";

const Body = z.object({
  image: z.string().min(1), // data URL (image/png|jpeg)
  question: z.string().max(1000).default("O que você vê na tela? Como posso usar isso?"),
});

/** "Ver a tela": recebe um screenshot + pergunta e analisa com um modelo de visão. */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });

  const { image, question } = parsed.data;
  const comecou = Date.now();
  try {
    const { text, usage } = await generateText({
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
    registrarUso({
      userId: session.user.id,
      fluxo: FLUXO.visao,
      referencia: "tela",
      servico: "visao-gateway",
      consumo: { unidade: "tokens", entrada: usage?.inputTokens ?? 0, saida: usage?.outputTokens ?? 0 },
      duracaoMs: Date.now() - comecou,
    });
    return Response.json({ answer: text.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("vision", { error: msg });
    // falha também deixa linha: foi ela que denunciou a conta sem crédito
    registrarUso({
      userId: session.user.id,
      fluxo: FLUXO.visao,
      referencia: "tela",
      servico: "visao-gateway",
      consumo: { unidade: "tokens", entrada: 0, saida: 0 },
      duracaoMs: Date.now() - comecou,
      erro: msg.slice(0, 200),
    });
    return Response.json(
      { error: "Modelo de visão indisponível. Baixe um no Ollama (ex.: `ollama pull moondream` ou `qwen2.5vl`) ou configure OPENAI_API_KEY." },
      { status: 502 },
    );
  }
}
