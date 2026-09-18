// Migrada do Next em paridade (apps/web/src/app/api/chat/route.ts).
import { streamText, stepCountIs } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  resolveModel, resolveVisionModel, getModelInfo, routeModelKey, providerEnv, discoveredSnapshot,
  buildModelChain, discoverModels, recordProviderResult, CACHE_BREAK,
} from "@orbita/llm";
import { db } from "@orbita/db";
import { conversation, message } from "@orbita/db/chat-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { retrieveContext, type RagHit } from "@orbita/core/rag/retrieve";
import { buildAllTools, SYSTEM_PROMPT, buildTemporalContext, buildPersonaContext } from "@orbita/core/chat/tools";
import { composeSystem, type Chunk } from "@orbita/core/chat/compose";
import { log } from "@orbita/core/observability/logger";
import { rateLimit, tooMany } from "@orbita/core/ratelimit";
import { settings } from "@orbita/core/settings/index";
import { applyLlmSettings } from "@orbita/core/settings/apply";
import { parseVoiceClip, requesterResolver } from "@orbita/core/identity/requester";
import { ehComandoDaCasa, vocabularioDaCasa } from "@orbita/core/chat/fast-path";

const BodySchema = z.object({
  content: z.string().min(1).max(8000),
  modelKey: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  // rich=true → stream NDJSON com passos de ferramenta (timeline de atividade).
  // Ausente/false → stream de texto puro (usado pelo mobile).
  rich: z.boolean().optional(),
  // imagem anexada (data URL) — ativa o modelo de visão para responder sobre ela.
  image: z.string().max(8_000_000).optional(),
  // trecho curto de áudio gravado junto do ditado (data URL), para saber QUEM
  // pediu (Onda 9). Vai só para o serviço LOCAL de percepção; teto real em
  // `identity.commandClipMaxKB`, este é só o limite duro do JSON.
  voiceClip: z.string().max(6_000_000).optional(),
  // modo privacidade: o navegador diz que NADA pode ir para a nuvem; qual
  // modelo local atende é decisão do servidor, que conhece a descoberta
  privacidade: z.boolean().optional(),
  // de qual dispositivo veio o pedido (B5.4): é o "aqui" de "apaga a luz daqui"
  deviceId: z.string().uuid().optional(),
});

const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.\n\n";

/** Mensagem amigável e ACIONÁVEL por provedor (não vaza detalhe interno). */
function providerDownMessage(key: string): string {
  if (key.startsWith("claude/")) return "O Claude Max está indisponível (limite ou instabilidade).";
  if (key.startsWith("gateway/")) return "O provedor de nuvem (Gateway) falhou.";
  return "O modelo local (Ollama) não respondeu.";
}

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  // Config do motor (cache curto; mudou na tela, vale no próximo turno). Uma
  // leitura só por turno: nada de constante no código (CLAUDE.md §5.6).
  const cfg = await settings.getMany([
    "chat.historyWindow", "chat.ragTimeoutMs", "chat.trivialMaxChars", "chat.conversationalMaxChars", "chat.maxSteps", "chat.maxRetries", "chat.rateLimitPerMinute",
    "chat.outputCapSmall", "chat.outputCapMedium", "chat.outputCapLarge",
    "prompt.budgetTokens", "prompt.priorityPersona", "prompt.priorityTemporal", "prompt.prioritySkills", "prompt.priorityRag",
    "rag.topK", "identity.commandClipMaxKB",
    "chat.fastPathEnabled", "chat.fastPathMaxChars", "chat.fastPathHistory",
  ]);
  await applyLlmSettings();
  const OUT_CAP: Record<string, number> = { small: cfg["chat.outputCapSmall"], medium: cfg["chat.outputCapMedium"], large: cfg["chat.outputCapLarge"] };

  // rate limit por usuário: cada turno dispara LLM+RAG+embeddings (custo-DoS).
  const rl = rateLimit(`chat:${session.user.id}`, cfg["chat.rateLimitPerMinute"], 60_000);
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
  const { content, modelKey, conversationId, rich, image, voiceClip, deviceId, privacidade } = parsed.data;

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

  // CAMINHO RÁPIDO (B10.1): comando curto da casa não precisa de memória,
  // persona, skills, MCP nem histórico longo. Ver chat/fast-path.ts.
  const rapido =
    cfg["chat.fastPathEnabled"] && !image && ehComandoDaCasa(content, await vocabularioDaCasa(session.user.id).catch(() => ({ verbos: [], alvos: [] })), cfg["chat.fastPathMaxChars"]);
  if (rapido) log.info("chat.caminho_rapido", { userId: session.user.id });

  // histórico: janela das últimas mensagens (evita estourar contexto/custo).
  const HISTORY_WINDOW = rapido ? cfg["chat.fastPathHistory"] : cfg["chat.historyWindow"];
  const recent = await db
    .select({ role: message.role, content: message.content })
    .from(message)
    .where(eq(message.conversationId, conv.id))
    .orderBy(desc(message.createdAt))
    .limit(HISTORY_WINDOW);
  const history = recent.reverse();

  // persiste a mensagem do usuário (marca se veio com imagem)
  await db.insert(message).values({ conversationId: conv.id, role: "user", content: image ? content + " [imagem anexada]" : content });

  // última mensagem do usuário: multimodal se houver imagem
  const lastUser = image
    ? { role: "user" as const, content: [{ type: "text" as const, text: content }, { type: "image" as const, image }] }
    : { role: "user" as const, content };
  const modelMessages = [...history.map((m) => ({ role: m.role, content: m.content })), lastUser];

  const env = providerEnv();

  // DESCOBERTA (cacheada ~5min): quais modelos existem de fato agora. Substitui
  // o antigo ping `ollamaUp()` no caminho quente — a listagem do Ollama JÁ é o
  // ping: se ele estiver fora, simplesmente não há modelo local descoberto, e o
  // failover cai para a nuvem sem pagar um timeout de 1,5s por turno.
  if (!image) await discoverModels();

  // modelo primário (resolve o "auto" por complexidade)
  let primaryKey = image ? "vision" : modelKey === "auto" ? routeModelKey(content, env) : modelKey;
  if (privacidade && !image && !primaryKey.startsWith("local/")) {
    const local = discoveredSnapshot().find((m) => m.key.startsWith("local/"));
    if (!local) {
      return Response.json(
        { error: "Modo privacidade ligado e nenhum modelo local disponível. Instale um modelo no Ollama (ex.: ollama pull qwen2.5:7b) ou desligue o modo privacidade." },
        { status: 503 },
      );
    }
    primaryKey = local.key;
  }

  // CADEIA DE FAILOVER: primário → um fallback por provedor descoberto.
  const candidates = image ? ["vision"] : buildModelChain(primaryKey, env);
  if (!candidates.length) {
    // Nenhum provedor disponível: mensagem ESPECÍFICA e acionável (não genérica).
    return Response.json(
      { error: "Nenhum modelo disponível. Rode `ollama serve` com algum modelo instalado, ou configure um provedor de nuvem (Claude Max, Gateway, Groq, Gemini…) no .env." },
      { status: 503, headers: { "x-conversation-id": conv.id } },
    );
  }

  // Pré-processamento em PARALELO (persona + ferramentas + RAG), fail-soft.
  // Gate do RAG bloqueante (R4 — desacopla o TTFT): pulamos a pré-injeção para
  // mensagens triviais e claramente CONVERSACIONAIS (saudação/agradecimento curto
  // sem indício de contexto pessoal). Nesses casos o stream começa sem esperar o
  // embedding+busca. Se ainda assim precisar do conhecimento do usuário, o modelo
  // chama a tool `buscar_conhecimento` sob demanda (rede de segurança).
  const RAG_TIMEOUT = cfg["chat.ragTimeoutMs"];
  const c = content.trim();
  const personalHint = /\b(meu|minh|nosso|lembr|anot|salv|guard|document|arquivo|planilha|extrato|comprovante|reuni|combin|falei|conversa|discut|prometi|agend|tarefa|compromisso|gast|conta|financ|onde eu|quando eu|o que eu)/i.test(c);
  const conversational = /^(oi|ol[áa]|e a[íi]|bom dia|boa tarde|boa noite|tudo bem|como vai|obrigad|valeu|blz|beleza|legal|show|perfeito|[óo]timo|entendi|ok|opa|eai|e a[íi])\b/i.test(c) && c.length < cfg["chat.conversationalMaxChars"] && !personalHint;
  const trivial = rapido || (!image && (c.length < cfg["chat.trivialMaxChars"] || conversational));
  const ragTask: Promise<RagHit[]> = trivial
    ? Promise.resolve([])
    : Promise.race([
        retrieveContext(userId, content, cfg["rag.topK"]).catch(() => [] as RagHit[]),
        new Promise<RagHit[]>((res) => setTimeout(() => res([]), RAG_TIMEOUT)),
      ]);

  // QUEM PEDE: a identificação por voz começa já, em paralelo, e só é aguardada
  // se uma tool precisar (permissão por cômodo, nota na fila de aprovação).
  // com imagem anexada o turno já vai pesado (data URL de megabytes) e o
  // caminho é o modelo de visão, que não usa "quem pediu": o trecho de voz
  // seria custo puro, então é descartado de propósito
  const clip = voiceClip && !image ? parseVoiceClip(voiceClip, cfg["identity.commandClipMaxKB"]) : null;
  const quemPede = requesterResolver(userId, clip, deviceId ?? null);
  if (clip) void quemPede.voice();

  const [personaCtx, toolsRes, ragHits] = await Promise.all([
    rapido ? Promise.resolve("") : buildPersonaContext(userId).catch(() => ""),
    buildAllTools(userId, content, quemPede.resolve, quemPede.origin, quemPede.voiceRef, rapido ? { dominios: ["casa"] } : {}),
    ragTask,
  ]);
  const { tools, cleanup, skillInstructions } = toolsRes;

  // cleanup idempotente: com failover, pode ser chamado por várias tentativas.
  let cleaned = false;
  const cleanupOnce = async () => {
    if (cleaned) return;
    cleaned = true;
    await cleanup();
  };

  const chunks: Chunk[] = [
    { content: SYSTEM_PROMPT, priority: 130 },
    { content: buildTemporalContext(), priority: cfg["prompt.priorityTemporal"] },
  ];
  if (personaCtx) chunks.push({ content: personaCtx, priority: cfg["prompt.priorityPersona"] });
  if (skillInstructions) chunks.push({ content: skillInstructions, priority: cfg["prompt.prioritySkills"] });
  if (ragHits.length) {
    chunks.push({
      content:
        "\n\nContexto do usuário (use quando relevante e cite a fonte entre colchetes):\n" +
        ragHits.map((h, i) => `[${i + 1}] (${h.source}) ${h.content}`).join("\n\n"),
      priority: cfg["prompt.priorityRag"],
      compressible: true,
    });
  }
  const coreBase = chunks[0].content;
  const restSystem = composeSystem(chunks.slice(1), cfg["prompt.budgetTokens"]);

  // system por modelo: só o Claude leva a identidade Claude Code + CACHE_BREAK
  // (cache_control no bloco estável). Os demais recebem o system direto.
  const systemFor = (key: string) =>
    key.startsWith("claude/")
      ? CLAUDE_CODE_IDENTITY + coreBase + CACHE_BREAK + restSystem
      : coreBase + restSystem;
  const maxTokensFor = (key: string) => (image ? 1024 : OUT_CAP[getModelInfo(key)?.tier ?? "medium"] ?? 2048);

  // Fábrica de stream para um modelo específico da cadeia.
  const makeStream = (key: string) => {
    const model = image ? resolveVisionModel() : resolveModel(key);
    const persistKey = image ? "vision" : key;
    const started = Date.now();
    return streamText({
      model,
      system: systemFor(key),
      messages: modelMessages,
      tools: image ? undefined : tools, // visão local não faz function-calling
      stopWhen: stepCountIs(cfg["chat.maxSteps"]),
      maxOutputTokens: maxTokensFor(key),
      maxRetries: cfg["chat.maxRetries"],
      onAbort: () => void cleanupOnce(),
      onFinish: async ({ text, usage, providerMetadata }) => {
        const latencyMs = Date.now() - started;
        const tokens = usage?.outputTokens ?? usage?.totalTokens ?? null;
        const anth = providerMetadata?.anthropic as { cacheReadInputTokens?: number; cacheCreationInputTokens?: number } | undefined;
        await db.insert(message).values({
          conversationId: conv.id, role: "assistant", content: text,
          modelKey: persistKey, tokens: tokens ?? undefined, latencyMs,
        });
        await db.update(conversation).set({ updatedAt: new Date(), modelKey: persistKey }).where(eq(conversation.id, conv.id));
        log.info("chat", {
          userId, model: persistKey, tokens: tokens ?? 0, latencyMs, conv: conv.id,
          cacheRead: anth?.cacheReadInputTokens ?? 0, cacheWrite: anth?.cacheCreationInputTokens ?? 0,
        });
        await cleanupOnce();
      },
      onError: (e) => {
        const outer = (e as { error?: Record<string, unknown> })?.error ?? {};
        const inner = (outer.lastError as Record<string, unknown>) ?? outer;
        log.error("chat.stream", {
          model: persistKey,
          status: inner.statusCode ?? outer.statusCode,
          body: String(inner.responseBody ?? inner.message ?? "").slice(0, 400),
        });
      },
    });
  };

  const headers = { "x-conversation-id": conv.id, "x-model": candidates[0] };

  if (rich) {
    // Stream NDJSON com FAILOVER: tenta cada modelo da cadeia; enquanto não sair
    // texto, um erro de provedor faz cair para o próximo (silencioso p/ o usuário).
    // Depois do 1º token não dá pra trocar — aí o erro é reportado.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
        let finished = false;
        for (let i = 0; i < candidates.length && !finished; i++) {
          const key = candidates[i];
          let result: ReturnType<typeof makeStream>;
          try { result = makeStream(key); } catch { continue; } // provedor não resolvido → próximo
          const buffered: unknown[] = [];
          let gotText = false;
          try {
            for await (const part of result.fullStream) {
              if (part.type === "text-delta") {
                if (!gotText) { gotText = true; if (i > 0) send({ t: "model", key }); for (const b of buffered) send(b); }
                send({ t: "text", v: part.text });
              } else if (part.type === "tool-call") {
                const ev = { t: "tool", name: part.toolName, args: part.input };
                gotText ? send(ev) : buffered.push(ev);
              } else if (part.type === "tool-result") {
                const ev = { t: "tool-done", name: part.toolName };
                gotText ? send(ev) : buffered.push(ev);
              } else if (part.type === "error") {
                if (!gotText) throw new Error("provider-error"); // ainda dá p/ trocar
                send({ t: "error", msg: "A resposta foi interrompida. Tente reenviar." });
                finished = true;
              }
            }
            finished = true;
            recordProviderResult(key, gotText); // sucesso fecha o disjuntor do provedor
          } catch {
            recordProviderResult(key, false); // falha conta p/ abrir o disjuntor
            if (gotText) { finished = true; } // já emitiu texto: não troca no meio
            // senão: silenciosamente tenta o próximo candidato da cadeia
          }
        }
        if (!finished) {
          // todos os candidatos falharam → mensagem específica do primário + dica
          send({ t: "error", msg: providerDownMessage(candidates[0]) + " Tentei os outros provedores disponíveis e todos falharam. Tente de novo em instantes." });
        }
        await cleanupOnce();
        controller.close();
      },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
  }

  // Path texto puro (mobile): usa o primeiro candidato disponível (+ maxRetries).
  // Sem failover no meio do stream, mas o Ollama-fora-do-ar já foi filtrado acima.
  for (const key of candidates) {
    try {
      return makeStream(key).toTextStreamResponse({ headers: { ...headers, "x-model": key } });
    } catch {
      continue;
    }
  }
  await cleanupOnce();
  return Response.json({ error: providerDownMessage(candidates[0]) + " Tente de novo." }, { status: 503, headers });
}
