import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { document, chunk, memory } from "@/lib/db/knowledge-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const userId = session.user.id;

  const [docs] = await db.select({ n: count() }).from(document).where(eq(document.userId, userId));
  const [chunks] = await db.select({ n: count() }).from(chunk).where(eq(chunk.userId, userId));
  const [mems] = await db.select({ n: count() }).from(memory).where(eq(memory.userId, userId));

  return Response.json({
    documents: docs?.n ?? 0,
    chunks: chunks?.n ?? 0,
    memories: mems?.n ?? 0,
  });
}
