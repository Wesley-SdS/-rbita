import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// referência de custo de nuvem (mesma do painel de sessão)
const BRL = 5.35;
const GPT_PER_1K = 0.05;

// Cache por usuário: as agregações são pesadas (11 subqueries) e analytics não é
// tempo-real. TTL curto deixa revisitas instantâneas sem sacrificar a atualidade.
const ANALYTICS_TTL_MS = 30_000;
const cache = new Map<string, { at: number; data: unknown }>();

/** Dashboard pessoal: uso, economia vs nuvem, atividade — dados reais agregados. */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const uid = session.user.id;

  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < ANALYTICS_TTL_MS) {
    return Response.json(hit.data, { headers: { "Cache-Control": "private, max-age=30", "x-cache": "hit" } });
  }

  // CTE `msg`: varre a tabela `message` UMA vez (antes eram 4 subqueries correlacionadas)
  // usando agregações com FILTER; os demais são counts de tabela única (rápidos).
  const [totals] = await db.execute(sql`
    WITH msg AS (
      SELECT
        count(*) AS messages,
        coalesce(sum(m.tokens) FILTER (WHERE m.role = 'assistant'), 0) AS tokens,
        coalesce(sum(m.tokens) FILTER (WHERE m.role = 'assistant' AND m.model_key LIKE 'local/%'), 0) AS local_tokens,
        coalesce(round(avg(m.latency_ms) FILTER (WHERE m.latency_ms IS NOT NULL)), 0) AS avg_latency_ms
      FROM message m JOIN conversation c ON c.id = m.conversation_id
      WHERE c.user_id = ${uid}
    )
    SELECT
      (SELECT count(*) FROM conversation WHERE user_id = ${uid}) AS conversations,
      msg.messages, msg.tokens, msg.local_tokens, msg.avg_latency_ms,
      (SELECT count(*) FROM document WHERE user_id = ${uid}) AS documents,
      (SELECT count(*) FROM memory WHERE user_id = ${uid}) AS memories,
      (SELECT count(*) FROM routine WHERE user_id = ${uid} AND enabled = true) AS active_routines,
      (SELECT count(*) FROM notification WHERE user_id = ${uid}) AS notifications,
      (SELECT count(*) FROM connection WHERE user_id = ${uid}) AS connectors,
      (SELECT coalesce(sum(amount_cents),0) FROM expense WHERE user_id = ${uid}) AS expense_cents
    FROM msg
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

  const data = {
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
  };
  cache.set(uid, { at: Date.now(), data });
  return Response.json(data, { headers: { "Cache-Control": "private, max-age=30", "x-cache": "miss" } });
}
