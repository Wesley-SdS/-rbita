import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { settings } from "@orbita/core/settings/index";
import { montarSetupTranscricao, urlSessaoGemini } from "@orbita/core/realtime/gemini";
import { criarTokenEfemeroGemini } from "@orbita/core/realtime/token";
import { log } from "@orbita/core/observability/logger";

/**
 * GET /api/meeting/live — como a prévia ao vivo deve ser feita nesta casa.
 *
 * A tela precisa saber ANTES de começar a gravar: tentar o Gemini para
 * descobrir que está desligado custaria uma sessão paga por reunião.
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const modo = await settings.get("meetings.liveTranscription");
  const temChave = Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY);
  // escolher Gemini sem a chave viraria uma reunião sem prévia nenhuma e sem
  // explicação; o navegador é a reserva honesta
  return Response.json({ modo: modo === "gemini" && !temChave ? "navegador" : modo });
}

/**
 * POST /api/meeting/live — abre a sessão de transcrição ao vivo da reunião.
 *
 * Mesma mecânica da conversa por voz (token efêmero, WebSocket direto do
 * navegador com o Google), com um propósito diferente: aqui a Órbita não
 * responde nada, só escuta e devolve texto.
 *
 * A transcrição FINAL não passa por aqui. Ela continua sendo feita sobre a
 * gravação inteira no fim, que é onde a separação de quem falou funciona.
 */
export async function POST(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const cfg = await settings.getMany(["meetings.liveTranscription", "meetings.liveModel"]);
  if (cfg["meetings.liveTranscription"] !== "gemini") {
    return Response.json({ error: "A prévia ao vivo pelo Gemini está desligada em Ajustes." }, { status: 400 });
  }
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) return Response.json({ error: "Falta a GEMINI_API_KEY para a prévia ao vivo." }, { status: 400 });

  try {
    const token = await criarTokenEfemeroGemini(key);
    const modelo = cfg["meetings.liveModel"];
    log.info("meeting.live", { userId: session.user.id, model: modelo });
    return Response.json({ url: urlSessaoGemini(token), setup: montarSetupTranscricao(modelo), model: modelo });
  } catch (e) {
    log.error("meeting.live", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Não consegui abrir a transcrição ao vivo." }, { status: 502 });
  }
}
