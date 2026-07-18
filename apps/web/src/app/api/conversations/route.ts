import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversation } from "@/lib/db/chat-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select({ id: conversation.id, title: conversation.title, modelKey: conversation.modelKey, updatedAt: conversation.updatedAt })
    .from(conversation)
    .where(eq(conversation.userId, session.user.id))
    .orderBy(desc(conversation.updatedAt))
    .limit(50);
  return Response.json({ conversations: rows });
}
