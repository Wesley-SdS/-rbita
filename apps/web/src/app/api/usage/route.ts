import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversation, message } from "@/lib/db/chat-schema";
import { getSession } from "@/lib/session";
import { summarizeUsage, USAGE_ASSUMPTIONS, type UsageRow } from "@/lib/usage/economics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Painel "economia vs nuvem": agrega as respostas do assistente do usuário
 * (modelo resolvido, tokens de saída, latência — dados REAIS) e estima
 * quanto de nuvem foi evitado + a energia local consumida.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const rows: UsageRow[] = await db
    .select({ modelKey: message.modelKey, tokens: message.tokens, latencyMs: message.latencyMs })
    .from(message)
    .innerJoin(conversation, eq(message.conversationId, conversation.id))
    .where(eq(conversation.userId, session.user.id));

  // só as respostas do assistente têm modelKey/tokens; as do usuário vêm nulas.
  const assistant = rows.filter((r) => r.modelKey !== null);
  const summary = summarizeUsage(assistant);

  return Response.json({ ...summary, assumptions: USAGE_ASSUMPTIONS });
}
