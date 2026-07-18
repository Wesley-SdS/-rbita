import { getSession } from "@/lib/session";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Transcreve áudio via AssemblyAI (fallback quando o STT local está offline). */
async function assemblyai(file: File, key: string): Promise<string> {
  const up = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { authorization: key },
    body: Buffer.from(await file.arrayBuffer()),
  });
  const { upload_url } = (await up.json()) as { upload_url: string };
  const start = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, language_code: "pt" }),
  });
  const { id } = (await start.json()) as { id: string };
  // poll até concluir (máx ~2 min)
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: { authorization: key } });
    const d = (await res.json()) as { status: string; text?: string; error?: string };
    if (d.status === "completed") return d.text ?? "";
    if (d.status === "error") throw new Error(d.error ?? "assemblyai error");
  }
  throw new Error("assemblyai timeout");
}

/** STT: serviço local (faster-whisper) → fallback AssemblyAI se configurado. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const form = await req.formData();
  const url = (process.env.VOICE_URL ?? "http://localhost:8001") + "/stt";

  // 1) tenta o STT local
  try {
    const res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
    if (res.ok) return Response.json(await res.json());
  } catch {
    /* cai para o fallback */
  }

  // 2) fallback AssemblyAI (se a chave estiver configurada)
  const key = process.env.ASSEMBLYAI_API_KEY;
  const file = form.get("file");
  if (key && file instanceof File) {
    try {
      const text = await assemblyai(file, key);
      return Response.json({ text, provider: "assemblyai" });
    } catch (e) {
      log.error("stt.assemblyai", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return Response.json({ error: "Serviço de voz indisponível (apps/voice offline e sem AssemblyAI)" }, { status: 503 });
}
