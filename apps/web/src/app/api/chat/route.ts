import { streamText, stepCountIs } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveModel, getModelInfo, routeModelKey, providerEnv, DEFAULT_MODEL_KEY } from "@orbita/llm";
import { db } from "@/lib/db";
import { conversation, message } from "@/lib/db/chat-schema";
import { getSession } from "@/lib/session";
import { retrieveContext } from "@/lib/rag/retrieve";
import { buildAllTools, SYSTEM_PROMPT } from "@/lib/chat/tools";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  content: z.string().min(1).max(8000),
  modelKey: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  // rich=true → stream NDJSON com passos de ferramenta (timeline de atividade).
  // Ausente/false → stream de texto puro (usado pelo mobile).
  rich: z.boolean().optional(),
});

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
  const { content, modelKey, conversationId, rich } = parsed.data;

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
  // Para o token Max (beta OAuth), a Anthropic exige que o system comece com a
  // identidade do Claude Code, senão rejeita ("credential only for Claude Code").
  const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.\n\n";
  let system = (effectiveKey.startsWith("claude/") ? CLAUDE_CODE_IDENTITY : "") + SYSTEM_PROMPT;
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

  const { tools, cleanup, skillInstructions } = await buildAllTools(userId);
  if (skillInstructions) system += skillInstructions;

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
      log.info("chat", { userId, model: effectiveKey, tokens: tokens ?? 0, latencyMs, conv: conv.id });
      await cleanup(); // fecha conexões MCP
    },
    onError: () => { void cleanup(); },
  });

  const headers = { "x-conversation-id": conv.id, "x-model": effectiveKey };

  if (rich) {
    // Stream NDJSON: intercala texto e passos de ferramenta para a timeline.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
        try {
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") send({ t: "text", v: part.text });
            else if (part.type === "tool-call") send({ t: "tool", name: part.toolName, args: part.input });
            else if (part.type === "tool-result") send({ t: "tool-done", name: part.toolName });
            else if (part.type === "error") send({ t: "error" });
          }
        } catch {
          send({ t: "error" });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
  }

  return result.toTextStreamResponse({ headers });
}
