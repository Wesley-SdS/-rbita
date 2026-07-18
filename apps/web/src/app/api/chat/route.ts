import { streamText, tool, stepCountIs } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveModel, getModelInfo, routeModelKey, providerEnv, DEFAULT_MODEL_KEY, embedText } from "@orbita/llm";
import { db } from "@/lib/db";
import { conversation, message } from "@/lib/db/chat-schema";
import { memory } from "@/lib/db/knowledge-schema";
import { getSession } from "@/lib/session";
import { retrieveContext } from "@/lib/rag/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  content: z.string().min(1).max(8000),
  modelKey: z.string().min(1),
  conversationId: z.string().uuid().optional(),
});

const SYSTEM_PROMPT =
  "Você é a ÓRBITA, uma assistente pessoal de IA em português do Brasil. " +
  "Seja direta, útil e amigável. Responda de forma concisa a menos que peçam detalhes.";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { content, modelKey, conversationId } = parsed.data;

  const info = getModelInfo(modelKey);
  if (!info) return Response.json({ error: "Modelo desconhecido" }, { status: 400 });

  const userId = session.user.id;

  // conversa (carrega ou cria, sempre do dono)
  let conv;
  if (conversationId) {
    [conv] = await db
      .select()
      .from(conversation)
      .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)))
      .limit(1);
    if (!conv) return Response.json({ error: "Conversa não encontrada" }, { status: 404 });
  } else {
    [conv] = await db
      .insert(conversation)
      .values({ userId, modelKey, title: content.slice(0, 60) })
      .returning();
  }
  if (!conv) return Response.json({ error: "Falha ao criar conversa" }, { status: 500 });

  // histórico
  const history = await db
    .select({ role: message.role, content: message.content })
    .from(message)
    .where(eq(message.conversationId, conv.id))
    .orderBy(asc(message.createdAt));

  // persiste a mensagem do usuário
  await db.insert(message).values({ conversationId: conv.id, role: "user", content });

  const modelMessages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content },
  ];

  // Auto-router: resolve "auto" para um modelo concreto por complexidade.
  let effectiveKey = modelKey === "auto" ? routeModelKey(content, providerEnv()) : modelKey;

  // Resolve o modelo; se o provedor não estiver disponível, faz fallback pro local.
  let model;
  try {
    model = resolveModel(effectiveKey);
  } catch {
    effectiveKey = DEFAULT_MODEL_KEY;
    model = resolveModel(effectiveKey);
  }

  // RAG: recupera contexto dos documentos + memória do usuário.
  let system = SYSTEM_PROMPT;
  try {
    const hits = await retrieveContext(userId, content, 4);
    if (hits.length) {
      system +=
        "\n\nContexto do usuário (use quando relevante e cite a fonte entre colchetes):\n" +
        hits.map((h, i) => `[${i + 1}] (${h.source}) ${h.content}`).join("\n\n");
    }
  } catch {
    // RAG é best-effort; se falhar, segue sem contexto.
  }

  // Ferramentas que a Órbita pode chamar (funcionam local, sem OAuth).
  const tools = {
    hora_atual: tool({
      description: "Retorna a data e a hora atuais do sistema.",
      inputSchema: z.object({}),
      execute: async () => ({ agora: new Date().toLocaleString("pt-BR") }),
    }),
    salvar_memoria: tool({
      description: "Salva um fato ou preferência do usuário na memória de longo prazo para lembrar depois.",
      inputSchema: z.object({ fato: z.string().describe("o fato a memorizar") }),
      execute: async ({ fato }) => {
        const embedding = await embedText(fato);
        await db.insert(memory).values({ userId, content: fato, embedding });
        return { salvo: true, fato };
      },
    }),
    buscar_conhecimento: tool({
      description: "Busca nos documentos e na memória do usuário por informação relevante.",
      inputSchema: z.object({ consulta: z.string() }),
      execute: async ({ consulta }) => {
        const hits = await retrieveContext(userId, consulta, 4);
        return { resultados: hits.map((h) => ({ fonte: h.source, trecho: h.content })) };
      },
    }),
  };

  const started = Date.now();

  const result = streamText({
    model,
    system,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    onFinish: async ({ text, usage }) => {
      const latencyMs = Date.now() - started;
      const tokens = usage?.outputTokens ?? usage?.totalTokens ?? null;
      await db.insert(message).values({
        conversationId: conv.id,
        role: "assistant",
        content: text,
        modelKey: effectiveKey,
        tokens: tokens ?? undefined,
        latencyMs,
      });
      await db
        .update(conversation)
        .set({ updatedAt: new Date(), modelKey: effectiveKey })
        .where(eq(conversation.id, conv.id));
    },
  });

  return result.toTextStreamResponse({
    headers: { "x-conversation-id": conv.id, "x-model": effectiveKey },
  });
}
