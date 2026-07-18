import { generateText } from "ai";
import { z } from "zod";
import { resolveModel, DEFAULT_MODEL_KEY } from "@orbita/llm";
import { ingestDocument } from "@/lib/rag/ingest";
import { getSession } from "@/lib/session";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  transcript: z.string().min(1).max(200000),
  title: z.string().max(200).optional(),
});

const PROMPT =
  "Você é a ÓRBITA. Resuma a transcrição de reunião a seguir em português do Brasil, com:\n" +
  "1. **Resumo** (2-3 frases).\n2. **Pontos principais** (bullets).\n3. **Decisões**.\n4. **Ações** (quem faz o quê, se houver).\n" +
  "Seja fiel à transcrição; não invente. Transcrição:\n\n";

/** Resume uma transcrição de reunião e a arquiva na memória/RAG do usuário. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error?.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const { transcript } = parsed.data;
  const title = parsed.data.title?.trim() || `Reunião ${new Date().toLocaleString("pt-BR")}`;
  const started = Date.now();

  let summary: string;
  try {
    const { text } = await generateText({ model: resolveModel(DEFAULT_MODEL_KEY), prompt: PROMPT + transcript });
    summary = text.trim();
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
