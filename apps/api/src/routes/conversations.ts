import { desc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { conversation } from "@orbita/db/chat-schema";
import type { RouteHandler } from "../http/web";
import { sessionOf } from "../http/web-route";

// Migrada do Next em paridade (apps/web/src/app/api/conversations/route.ts).

export const GET: RouteHandler = async (_req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select({ id: conversation.id, title: conversation.title, modelKey: conversation.modelKey, updatedAt: conversation.updatedAt })
    .from(conversation)
    .where(eq(conversation.userId, session.user.id))
    .orderBy(desc(conversation.updatedAt))
    .limit(50);
  return Response.json({ conversations: rows });
};
