import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Grafo de conhecimento pessoal: nós = memórias, arestas = pares de memórias
 * semanticamente próximas (similaridade de cosseno via pgvector). Revela como
 * as suas memórias se relacionam, sem precisar de extração de entidades.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const uid = session.user.id;

  const nodesRaw = await db.execute(sql`
    SELECT id, left(content, 80) AS label
    FROM memory WHERE user_id = ${uid}
    ORDER BY created_at DESC LIMIT 60
  `);
  const nodes = (nodesRaw as unknown as Array<{ id: string; label: string }>).map((n) => ({ id: n.id, label: n.label }));

  let edges: Array<{ source: string; target: string; sim: number }> = [];
  if (nodes.length > 1) {
    // arestas SÓ entre os mesmos 60 nós exibidos (CTE) — evita o cross-join
    // quadrático sobre todas as memórias do usuário.
    const raw = await db.execute(sql`
      WITH n AS (
        SELECT id, embedding FROM memory WHERE user_id = ${uid} ORDER BY created_at DESC LIMIT 60
      )
      SELECT a.id AS source, b.id AS target, round((1 - (a.embedding <=> b.embedding))::numeric, 3) AS sim
      FROM n a JOIN n b ON a.id < b.id
      WHERE (1 - (a.embedding <=> b.embedding)) > 0.55
      ORDER BY sim DESC LIMIT 150
    `);
    edges = (raw as unknown as Array<{ source: string; target: string; sim: string }>).map((e) => ({
      source: e.source,
      target: e.target,
      sim: Number(e.sim),
    }));
  }

  return Response.json({ nodes, edges });
}
