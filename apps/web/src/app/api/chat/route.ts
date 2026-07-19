import { streamText, stepCountIs } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveModel, resolveVisionModel, getModelInfo, routeModelKey, providerEnv, DEFAULT_MODEL_KEY, CACHE_BREAK } from "@orbita/llm";
import { db } from "@/lib/db";
import { conversation, message } from "@/lib/db/chat-schema";
import { getSession } from "@/lib/session";
import { retrieveContext } from "@/lib/rag/retrieve";
import { buildAllTools, SYSTEM_PROMPT, buildTemporalContext, buildPersonaContext } from "@/lib/chat/tools";
import { composeSystem, type Chunk } from "@/lib/chat/compose";
import { log } from "@/lib/observability/logger";
import { rateLimit, tooMany } from "@/lib/ratelimit";

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
  // imagem anexada (data URL) — ativa o modelo de visão para responder sobre ela.
  image: z.string().max(8_000_000).optional(),
});

/** Mensagem amigável em pt-BR para falha de stream (não vaza detalhe do provedor). */
function errorMessage(key: string, gotText: boolean): string {
  if (gotText) return "A resposta foi interrompida. Tente reenviar.";
  if (key.startsWith("claude/")) return "O Claude Max está indisponível no momento (limite ou instabilidade). Tente o modelo local ou aguarde um pouco.";
  if (key.startsWith("gateway/")) return "O provedor de nuvem falhou. Tente o modelo local.";
  return "Não consegui gerar a resposta agora. Tente de novo.";
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  // rate limit por usuário: cada turno dispara LLM+RAG+embeddings (custo-DoS).
  const rl = rateLimit(`chat:${session.user.id}`, 30, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

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
  const { content, modelKey, conversationId, rich, image } = parsed.data;

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

  // histórico: janela das últimas mensagens (evita estourar contexto/custo em
  // conversas longas — o modelo recebe um teto fixo de turnos recentes).
  const HISTORY_WINDOW = 24;
  const recent = await db
    .select({ role: message.role, content: message.content })
    .from(message)
    .where(eq(message.conversationId, conv.id))
    .orderBy(desc(message.createdAt))
    .limit(HISTORY_WINDOW);
  const history = recent.reverse(); // volta à ordem cronológica

  // persiste a mensagem do usuário (marca se veio com imagem)
  await db.insert(message).values({ conversationId: conv.id, role: "user", content: image ? content + " [imagem anexada]" : content });

  // última mensagem do usuário: multimodal se houver imagem
  const lastUser = image
    ? { role: "user" as const, content: [{ type: "text" as const, text: content }, { type: "image" as const, image }] }
    : { role: "user" as const, content };
  const modelMessages = [...history.map((m) => ({ role: m.role, content: m.content })), lastUser];

  // Com imagem, usa o modelo de VISÃO (o modelo de texto selecionado não "vê").
  let effectiveKey = image ? "vision" : modelKey === "auto" ? routeModelKey(content, providerEnv()) : modelKey;

  // Resolve o modelo; se o provedor não estiver disponível, faz fallback pro local.
  let model;
  try {
    model = image ? resolveVisionModel() : resolveModel(effectiveKey);
  } catch {
    effectiveKey = DEFAULT_MODEL_KEY;
    model = resolveModel(effectiveKey);
  }

  // Monta o system por CHUNKS tipados com prioridade + orçamento (PromptComposer).
  // Para o token Max (beta OAuth), o system precisa começar com a identidade do
  // Claude Code (o oauthFetch garante isso como 1º bloco; aqui só o prefixamos).
  const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.\n\n";
  const chunks: Chunk[] = [
    { content: (effectiveKey.startsWith("claude/") ? CLAUDE_CODE_IDENTITY : "") + SYSTEM_PROMPT, priority: 130 },
    { content: buildTemporalContext(), priority: 90 },
  ];

  // Persona configurável do usuário (abaixo só das regras de segurança).
  const personaCtx = await buildPersonaContext(userId);
  if (personaCtx) chunks.push({ content: personaCtx, priority: 120 });

  const { tools, cleanup, skillInstructions } = await buildAllTools(userId, content);
  if (skillInstructions) chunks.push({ content: skillInstructions, priority: 70 });

  try {
    const hits = await retrieveContext(userId, content, 4);
    if (hits.length) {
      chunks.push({
        content:
          "\n\nContexto do usuário (use quando relevante e cite a fonte entre colchetes):\n" +
          hits.map((h, i) => `[${i + 1}] (${h.source}) ${h.content}`).join("\n\n"),
        priority: 50,
        compressible: true, // RAG é cortado primeiro se faltar orçamento
      });
    }
  } catch {
    // RAG é best-effort; se falhar, segue sem contexto.
  }

  // Separa o núcleo ESTÁVEL (SYSTEM_PROMPT + identidade) do contexto VOLÁTIL para
  // permitir prompt caching no Claude: só o estável leva cache_control (via o
  // marcador CACHE_BREAK, que o oauthFetch interpreta). Nos demais modelos o
  // marcador não é inserido.
  const coreContent = chunks[0].content;
  const restSystem = composeSystem(chunks.slice(1));
  const system = effectiveKey.startsWith("claude/")
    ? coreContent + CACHE_BREAK + restSystem
    : coreContent + restSystem;

  const started = Date.now();

  // Teto de saída por porte do modelo (evita geração desgovernada/custo).
  const OUT_CAP: Record<string, number> = { small: 1024, medium: 2048, large: 4096 };
  const maxOutputTokens = image ? 1024 : OUT_CAP[getModelInfo(effectiveKey)?.tier ?? "medium"] ?? 2048;

  const result = streamText({
    model,
    system,
    messages: modelMessages,
    // O modelo de visão local (moondream) não faz function-calling: com imagem,
    // respondemos sem ferramentas para não retornar vazio.
    tools: image ? undefined : tools,
    stopWhen: stepCountIs(5),
    maxOutputTokens,
    maxRetries: 2, // backoff automático em 429/5xx transitório do provedor
    onAbort: () => void cleanup(),
    onFinish: async ({ text, usage, providerMetadata }) => {
      const latencyMs = Date.now() - started;
      const tokens = usage?.outputTokens ?? usage?.totalTokens ?? null;
      // tokens de prompt cache do Anthropic (verifica a eficácia do cache_control)
      const anth = providerMetadata?.anthropic as { cacheReadInputTokens?: number; cacheCreationInputTokens?: number } | undefined;
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
      log.info("chat", {
        userId, model: effectiveKey, tokens: tokens ?? 0, latencyMs, conv: conv.id,
        cacheRead: anth?.cacheReadInputTokens ?? 0, cacheWrite: anth?.cacheCreationInputTokens ?? 0,
      });
      await cleanup(); // fecha conexões MCP
    },
    onError: (e) => {
      const outer = (e as { error?: Record<string, unknown> })?.error ?? {};
      const inner = (outer.lastError as Record<string, unknown>) ?? outer; // desembrulha RetryError
      log.error("chat.stream", {
        model: effectiveKey,
        status: inner.statusCode ?? outer.statusCode,
        body: String(inner.responseBody ?? inner.message ?? "").slice(0, 400),
      });
      void cleanup();
    },
  });

  const headers = { "x-conversation-id": conv.id, "x-model": effectiveKey };

  if (rich) {
    // Stream NDJSON: intercala texto e passos de ferramenta para a timeline.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
        let gotText = false;
        try {
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") { gotText = true; send({ t: "text", v: part.text }); }
            else if (part.type === "tool-call") send({ t: "tool", name: part.toolName, args: part.input });
            else if (part.type === "tool-result") send({ t: "tool-done", name: part.toolName });
            else if (part.type === "error") send({ t: "error", msg: errorMessage(effectiveKey, gotText) });
          }
        } catch {
          send({ t: "error", msg: errorMessage(effectiveKey, gotText) });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
  }

  return result.toTextStreamResponse({ headers });
}
