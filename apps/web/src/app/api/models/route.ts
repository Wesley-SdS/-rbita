import { availableModels, providerEnv, DEFAULT_MODEL_KEY } from "@orbita/llm";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const env = providerEnv();
  return Response.json({
    models: availableModels(env),
    env,
    defaultModel: DEFAULT_MODEL_KEY,
  });
}
