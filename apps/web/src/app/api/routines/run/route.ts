import { generateText, stepCountIs } from "ai";
import { eq } from "drizzle-orm";
import { resolveModel, DEFAULT_MODEL_KEY } from "@orbita/llm";
import { db } from "@/lib/db";
import { routine, notification } from "@/lib/db/routine-schema";
import { buildAllTools, SYSTEM_PROMPT } from "@/lib/chat/tools";
import { getSession } from "@/lib/session";
import { sendPush } from "@/lib/push/send";
import { rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Executa as rotinas devidas do usuário (proatividade) e cria notificações. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const uid = session.user.id;

  // rotinas rodam generateText+tools por rotina devida (maxDuration 300s) — limita.
  const rl = rateLimit(`routines:${uid}`, 6, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const { force } = (await req.json().catch(() => ({}))) as { force?: boolean };

  const rows = await db.select().from(routine).where(eq(routine.userId, uid));
  const now = Date.now();
  const due = rows.filter(
    (r) => r.enabled && (force || !r.lastRunAt || now - r.lastRunAt.getTime() >= r.intervalMinutes * 60000),
  );

  const { tools, cleanup, skillInstructions } = await buildAllTools(uid);
  const model = resolveModel(DEFAULT_MODEL_KEY); // rotinas rodam local por padrão
  let criadas = 0;

  for (const r of due) {
    try {
      const { text } = await generateText({
        model,
        system: SYSTEM_PROMPT + skillInstructions + "\nVocê está executando uma rotina proativa. Produza um resultado útil e direto.",
        prompt: r.prompt,
        tools,
        stopWhen: stepCountIs(5),
      });
      const body = text?.trim() || "(sem conteúdo)";
      await db.insert(notification).values({ userId: uid, routineId: r.id, title: r.title, content: body });
      await db.update(routine).set({ lastRunAt: new Date() }).where(eq(routine.id, r.id));
      // também dispara push (best-effort; no-op se VAPID ausente ou sem inscrição)
      void sendPush(uid, { title: r.title, body: body.slice(0, 180), url: "/app" });
      criadas++;
    } catch {
      // rotina que falha não derruba as outras
    }
  }

  await cleanup(); // fecha conexões MCP
  return Response.json({ devidas: due.length, notificacoes: criadas });
}
