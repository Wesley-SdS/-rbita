import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Proxy para o serviço de voz (STT). Mantém a chamada atrás da auth do app. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const form = await req.formData();
  const url = (process.env.VOICE_URL ?? "http://localhost:8001") + "/stt";

  try {
    const res = await fetch(url, { method: "POST", body: form });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "Serviço de voz indisponível (apps/voice não está rodando?)" }, { status: 503 });
  }
}
