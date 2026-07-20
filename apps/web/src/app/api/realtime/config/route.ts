import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diz à UI se o modo tempo real (S2S premium) está configurado no servidor. */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const enabled = Boolean(process.env.OPENAI_API_KEY);
  // Estável por sessão (só depende do env) → cache no navegador evita re-fetch a cada mount.
  return Response.json(
    { enabled, provider: enabled ? "openai-realtime" : null },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
