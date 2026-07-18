import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// referência de custo de nuvem (mesma do painel de sessão)
const BRL = 5.35;
const GPT_PER_1K = 0.05;

/** Dashboard pessoal: uso, economia vs nuvem, atividade — dados reais agregados. */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const uid = session.user.id;

  const [totals] = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM conversation WHERE user_id = ${uid}) AS conversations,
      (SELECT count(*) FROM message m JOIN conversation c ON c.id = m.conversation_id WHERE c.user_id = ${uid}) AS messages,
      (SELECT coalesce(sum(tokens),0) FROM message m JOIN conversation c ON c.id = m.conversation_id WHERE c.user_id = ${uid} AND m.role='assistant') AS tokens,
      (SELECT coalesce(sum(tokens),0) FROM message m JOIN conversation c ON c.id = m.conversation_id WHERE c.user_id = ${uid} AND m.role='assistant' AND m.model_key LIKE 'local/%') AS local_tokens,
      (SELECT coalesce(round(avg(latency_ms)),0) FROM message m JOIN conversation c ON c.id = m.conversation_id WHERE c.user_id = ${uid} AND m.latency_ms IS NOT NULL) AS avg_latency_ms,
      (SELECT count(*) FROM document WHERE user_id = ${uid}) AS documents,
      (SELECT count(*) FROM memory WHERE user_id = ${uid}) AS memories,
      (SELECT count(*) FROM routine WHERE user_id = ${uid} AND enabled = true) AS active_routines,
      (SELECT count(*) FROM notification WHERE user_id = ${uid}) AS notifications,
      (SELECT count(*) FROM connection WHERE user_id = ${uid}) AS connectors,
      (SELECT coalesce(sum(amount_cents),0) FROM expense WHERE user_id = ${uid}) AS expense_cents
  `);

  const byModel = await db.execute(sql`
    SELECT coalesce(m.model_key,'?') AS model, count(*)::int AS n, coalesce(sum(m.tokens),0)::int AS tokens
    FROM message m JOIN conversation c ON c.id = m.conversation_id
    WHERE c.user_id = ${uid} AND m.role='assistant'
    GROUP BY m.model_key ORDER BY n DESC
  `);

  const daily = await db.execute(sql`
    SELECT to_char(date_trunc('day', m.created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n
    FROM message m JOIN conversation c ON c.id = m.conversation_id
    WHERE c.user_id = ${uid} AND m.created_at > now() - interval '14 days'
    GROUP BY day ORDER BY day
  `);

  const t = totals as Record<string, number>;
  const localTokens = Number(t.local_tokens ?? 0);
  const savedBRL = (localTokens / 1000) * GPT_PER_1K * BRL;

  return Response.json({
    totals: {
      conversations: Number(t.conversations ?? 0),
      messages: Number(t.messages ?? 0),
      tokens: Number(t.tokens ?? 0),
      localTokens,
      avgLatencyMs: Number(t.avg_latency_ms ?? 0),
      documents: Number(t.documents ?? 0),
      memories: Number(t.memories ?? 0),
      activeRoutines: Number(t.active_routines ?? 0),
      notifications: Number(t.notifications ?? 0),
      connectors: Number(t.connectors ?? 0),
      expenseBRL: Number(t.expense_cents ?? 0) / 100,
      savedBRL: Math.round(savedBRL * 100) / 100,
    },
    byModel,
    daily,
  });
}
