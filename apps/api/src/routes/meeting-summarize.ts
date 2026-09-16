// Migrada do Next em paridade (apps/web/src/app/api/meeting/summarize/route.ts).
import { generateText } from "ai";
import { z } from "zod";
import { resolveModel, DEFAULT_MODEL_KEY } from "@orbita/llm";
import { ingestDocument } from "@orbita/core/rag/ingest";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { log } from "@orbita/core/observability/logger";
import { settings } from "@orbita/core/settings/index";

const Body = z.object({
  // teto alto: a transcrição INTEIRA é arquivada no RAG (o corte acima vale só
  // para o prompt do resumo). ~500k chars cobre uma reunião de várias horas.
  transcript: z.string().min(1).max(500000),
  title: z.string().max(200).optional(),
});

const PROMPT =
  "Você é a ÓRBITA. Resuma a transcrição de reunião a seguir em português do Brasil, com:\n" +
  "1. **Resumo** (2-3 frases).\n2. **Pontos principais** (bullets).\n3. **Decisões**.\n4. **Ações** (quem faz o quê, se houver).\n" +
  "Quando a transcrição vier marcada com \"Locutor A/B/C\", use esses rótulos para atribuir falas, " +
  "decisões e ações. Não invente o NOME real de ninguém: se não souber quem é o Locutor A, escreva \"Locutor A\".\n" +
  "Seja fiel à transcrição; não invente. Transcrição:\n\n";

/**
 * Teto de entrada do resumo. O modelo padrão das rotinas roda local (janela de
 * 32k tokens ≈ 128k chars); acima disso a transcrição estouraria o contexto em
 * SILÊNCIO, e o resumo sairia truncado sem ninguém perceber. Cortamos de forma
 * explícita e avisamos na resposta. Reuniões muito longas precisam de resumo em
 * mapa-redução (resumir por blocos e depois consolidar) — ainda não implementado.
 */
/** Resume uma transcrição de reunião e a arquiva na memória/RAG do usuário. */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  // teto vem da config (`limits.summaryMaxChars`), não de constante
  const MAX_PROMPT_CHARS = await settings.get("limits.summaryMaxChars");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error?.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const { transcript } = parsed.data;
  const title = parsed.data.title?.trim() || `Reunião ${new Date().toLocaleString("pt-BR")}`;
  const started = Date.now();

  const truncated = transcript.length > MAX_PROMPT_CHARS;
  const paraResumir = truncated ? transcript.slice(0, MAX_PROMPT_CHARS) : transcript;

  let summary: string;
  try {
    const { text } = await generateText({ model: resolveModel(DEFAULT_MODEL_KEY), prompt: PROMPT + paraResumir });
    summary = text.trim();
    if (truncated) {
      summary += `\n\n⚠️ A reunião é longa (${Math.round(transcript.length / 1000)}k caracteres) e o resumo cobre só o começo. A transcrição completa foi arquivada.`;
    }
  } catch (e) {
    log.error("meeting.summarize", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Falha ao resumir (LLM local disponível?)" }, { status: 502 });
  }

  // arquiva transcrição + resumo no RAG (fica pesquisável e vira contexto do chat)
  const doc = `# ${title}\n\n## Resumo\n${summary}\n\n## Transcrição\n${transcript}`;
  const res = await ingestDocument(session.user.id, title, doc, "text").catch(() => ({ chunks: 0 }));

  log.info("meeting.summarize", { userId: session.user.id, ms: Date.now() - started, chars: transcript.length, chunks: res.chunks });
  return Response.json({ title, summary, archived: res.chunks > 0 });
}
