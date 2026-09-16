// Migrada do Next em paridade (apps/web/src/app/api/stt/route.ts).
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { transcribeAudio } from "@orbita/core/stt/index";
import { log } from "@orbita/core/observability/logger";
import { settings } from "@orbita/core/settings/index";

/** Controller fino: autentica, valida o arquivo e delega ao serviço de STT. */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  // Teto de upload (config `limits.sttMaxMb`). Uma reunião de ~2h em WebM/Opus
  // fica bem abaixo do default; acima é quase certo que algo saiu errado.
  const MAX_BYTES = (await settings.get("limits.sttMaxMb")) * 1024 * 1024;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Arquivo de áudio ausente" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Áudio grande demais (${Math.round(file.size / 1048576)}MB). Limite: ${MAX_BYTES / 1048576}MB.` },
      { status: 413 },
    );
  }

  // Diarização é opt-in: reunião pede, comando de voz não (custa mais e o
  // resultado de uma voz só não acrescenta nada).
  const diarize = form.get("diarize") === "true";
  const expectedRaw = Number(form.get("speakers"));
  const expectedSpeakers = Number.isInteger(expectedRaw) && expectedRaw >= 2 && expectedRaw <= 10 ? expectedRaw : undefined;

  const started = Date.now();
  try {
    const result = await transcribeAudio(file, { diarize, expectedSpeakers });
    log.info("stt", {
      userId: session.user.id,
      provider: result.provider,
      diarize,
      speakers: result.speakers ?? 0,
      bytes: file.size,
      ms: Date.now() - started,
    });
    return Response.json(result);
  } catch (e) {
    log.error("stt.failed", { error: e instanceof Error ? e.message : String(e), ms: Date.now() - started });
    return Response.json(
      { error: "Serviço de voz indisponível (apps/voice offline e sem AssemblyAI)" },
      { status: 503 },
    );
  }
}
