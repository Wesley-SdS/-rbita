import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { transcribeRecording } from "@orbita/core/meetings/transcribe";
import { log } from "@orbita/core/observability/logger";
import { settings } from "@orbita/core/settings/index";

/**
 * Transcrição IMEDIATA: ditado de comando no navegador (quando não há Web
 * Speech) e o app mobile, que espera o texto na resposta. É áudio de segundos.
 * Reunião gravada NÃO passa aqui: vai para `/api/meeting/transcribe`, que é
 * trabalho de fila. A lógica é a mesma (`meetings/transcribe.ts`).
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  // Teto de upload (config `limits.sttMaxMb`)
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

  // Diarização é opt-in e fica por compatibilidade (contrato da paridade); a
  // tela de reunião usa a rota de fila
  const diarize = form.get("diarize") === "true";
  const expectedRaw = Number(form.get("speakers"));
  const expectedSpeakers = Number.isInteger(expectedRaw) && expectedRaw >= 2 && expectedRaw <= 10 ? expectedRaw : undefined;

  const started = Date.now();
  try {
    const r = await transcribeRecording(session.user.id, new Uint8Array(await file.arrayBuffer()), file.type || "audio/webm", {
      diarize,
      expectedSpeakers,
      sourceRef: (form.get("documentId") as string | null) || null,
    });
    return Response.json(r);
  } catch (e) {
    log.error("stt.failed", { error: e instanceof Error ? e.message : String(e), ms: Date.now() - started });
    return Response.json({ error: "Serviço de voz indisponível (apps/voice offline e sem AssemblyAI)" }, { status: 503 });
  }
}
