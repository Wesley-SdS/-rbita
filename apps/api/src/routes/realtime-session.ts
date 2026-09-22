// Migrada do Next em paridade (apps/web/src/app/api/realtime/session/route.ts).
import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { SYSTEM_PROMPT } from "@orbita/core/chat/tools";
import { toolDefsForRealtime, type ToolDef } from "@orbita/core/tools/index";
import { log } from "@orbita/core/observability/logger";
import { settings } from "@orbita/core/settings/index";
import { escolherProvedorRealtime, type ChavesRealtime } from "@orbita/core/realtime/provider";
import { montarSetupGemini, urlSessaoGemini, type FuncaoDeclarada } from "@orbita/core/realtime/gemini";
import { criarTokenEfemeroGemini } from "@orbita/core/realtime/token";

/** Quais provedores de voz em tempo real têm credencial. Exportada para a rota de config não repetir a regra. */
export function chavesRealtime(): ChavesRealtime {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
  };
}

/**
 * O que a Órbita precisa saber além do system de sempre, por estar falando.
 * Vale para os dois provedores: o que muda entre eles é o transporte, não a
 * personalidade nem o gate.
 */
const INSTRUCAO_DE_VOZ =
  " Você está em conversa por voz em tempo real: fale de forma natural, breve e calorosa, em português do Brasil. Ações arriscadas (destrancar, desarmar, mandar mensagem) ficam esperando sua aprovação no painel; diga isso em vez de fingir que já fez.";

/**
 * Abre uma sessão de voz em tempo real. Dois caminhos, escolhidos por config
 * (`realtime.provider`) — ver `packages/core/src/realtime/provider.ts` para o
 * porquê do padrão ser o Gemini.
 *
 * Em ambos, a credencial REAL fica no servidor: o navegador recebe só um
 * segredo efêmero, de uso único, e abre a conexão direto com o provedor. O
 * áudio não passa por aqui — é o que mantém a latência baixa.
 *
 * Isto NÃO é o caminho da identificação por voz: reconhecer quem falou segue
 * sendo local, no apps/perception (§5.4.1). O que sai daqui é a conversa, do
 * mesmo jeito que já saía pela OpenAI.
 */
export async function POST(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const cfg = await settings.getMany(["realtime.provider", "realtime.geminiModel", "realtime.geminiVoice", "realtime.openaiModel", "realtime.openaiVoice"]);
  const provider = escolherProvedorRealtime(cfg["realtime.provider"], chavesRealtime());
  if (!provider) {
    return Response.json({ error: "Modo tempo real não configurado (falta GEMINI_API_KEY ou OPENAI_API_KEY)" }, { status: 400 });
  }

  // B7.2 (Onda 6): a sessão de voz ganha as MESMAS tools do chat de texto —
  // sem isso, o modo realtime só conversa, não aciona a casa nem mexe em
  // nada (briefing §7.2). O gate humano continua: uma tool arriscada
  // enfileira em vez de executar (ver runRealtimeTool em packages/core).
  const defs: ToolDef[] = await toolDefsForRealtime(session.user.id);
  const instrucoes = SYSTEM_PROMPT + INSTRUCAO_DE_VOZ;

  if (provider === "gemini") return sessaoGemini(defs, instrucoes, cfg["realtime.geminiModel"], cfg["realtime.geminiVoice"], session.user.id);
  return sessaoOpenAI(defs, instrucoes, cfg["realtime.openaiModel"], cfg["realtime.openaiVoice"], session.user.id);
}

/**
 * Gemini Live: o navegador recebe um token efêmero e a mensagem `setup` pronta.
 *
 * Duas surpresas da API, descobertas testando contra ela (a doc diz outra
 * coisa nas duas), que explicam o formato deste retorno:
 *
 * 1. `liveConnectConstraints` — que travaria o modelo e a config no token,
 *    do lado do servidor — é recusado com "Cannot find field". Então a config
 *    vai no `setup`, que o NAVEGADOR envia. Um cliente adulterado poderia
 *    mudar o prompt ou a lista de funções, e por isso a defesa que importa
 *    não está aqui: toda execução passa por `/api/realtime/tool`, que resolve
 *    a tool pelo registro do servidor e deriva o gate do risco (§5.1). Mentir
 *    na lista não dá permissão nenhuma a mais.
 * 2. O token efêmero só é aceito no endpoint `BidiGenerateContentConstrained`
 *    (o caminho comum responde "unregistered callers"), e só pela query
 *    `access_token`, porque o WebSocket do navegador não manda header.
 */
async function sessaoGemini(defs: ToolDef[], instrucoes: string, modelo: string, voz: string, userId: string) {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const funcoes: FuncaoDeclarada[] = defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: z.toJSONSchema(d.inputSchema) as Record<string, unknown>,
  }));

  try {
    const token = await criarTokenEfemeroGemini(key!);

    log.info("realtime.session", { userId, provider: "gemini", model: modelo, tools: funcoes.length });
    return Response.json({
      provider: "gemini",
      url: urlSessaoGemini(token),
      setup: montarSetupGemini({ modelo, voz, instrucoes, funcoes }),
      model: modelo,
      voice: voz,
    });
  } catch (e) {
    log.error("realtime.session", { provider: "gemini", error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Erro ao contatar o Gemini Live" }, { status: 502 });
  }
}

/**
 * OpenAI Realtime: cria uma sessão efêmera (client_secret). O token de curta
 * duração volta para o browser, que abre o WebRTC direto com a OpenAI — a
 * chave real (OPENAI_API_KEY) nunca sai do servidor.
 */
async function sessaoOpenAI(defs: ToolDef[], instrucoes: string, modelo: string, voz: string, userId: string) {
  const key = process.env.OPENAI_API_KEY;
  const tools = defs.map((d: ToolDef) => ({
    type: "function" as const,
    name: d.name,
    description: d.description,
    parameters: z.toJSONSchema(d.inputSchema) as Record<string, unknown>,
  }));

  try {
    // API atual (2026): cria um client secret efêmero com a config da sessão.
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: modelo,
          audio: { output: { voice: voz } },
          instructions: instrucoes,
          tools,
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      log.error("realtime.session", { provider: "openai", status: res.status, detail: detail.slice(0, 200) });
      return Response.json({ error: "Falha ao abrir sessão realtime" }, { status: 502 });
    }
    // resposta: { value: "ek_...", expires_at, session: {...} }
    const data = (await res.json()) as { value?: string; expires_at?: number };
    if (!data.value) return Response.json({ error: "Sessão sem token" }, { status: 502 });

    log.info("realtime.session", { userId, provider: "openai", model: modelo });
    return Response.json({ provider: "openai", clientSecret: data.value, model: modelo, voice: voz, expiresAt: data.expires_at });
  } catch (e) {
    log.error("realtime.session", { provider: "openai", error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Erro ao contatar a OpenAI Realtime" }, { status: 502 });
  }
}
