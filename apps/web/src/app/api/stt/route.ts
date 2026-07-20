import { getSession } from "@/lib/session";
import { transcribeAudio } from "@/lib/stt";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Controller fino: autentica, valida o arquivo e delega ao serviço de STT. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Arquivo de áudio ausente" }, { status: 400 });
  }

  try {
    return Response.json(await transcribeAudio(file));
  } catch (e) {
    log.error("stt.failed", { error: e instanceof Error ? e.message : String(e) });
    return Response.json(
      { error: "Serviço de voz indisponível (apps/voice offline e sem AssemblyAI)" },
      { status: 503 },
    );
  }
}
