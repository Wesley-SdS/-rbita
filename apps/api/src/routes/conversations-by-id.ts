import { and, asc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { conversation, message } from "@orbita/db/chat-schema";
import type { RouteHandler } from "../http/web";
import { sessionOf } from "../http/web-route";

// Migrada do Next em paridade (apps/web/src/app/api/conversations/[id]/route.ts).

export const GET: RouteHandler = async (_req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = ctx.params.id!;

  const [conv] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.userId, session.user.id)))
    .limit(1);
  if (!conv) return Response.json({ error: "Conversa não encontrada" }, { status: 404 });

  const msgs = await db
    .select({ role: message.role, content: message.content })
    .from(message)
    .where(eq(message.conversationId, id))
    .orderBy(asc(message.createdAt));

  return Response.json({ conversation: conv, messages: msgs });
};

export const DELETE: RouteHandler = async (_req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = ctx.params.id!;
  await db.delete(conversation).where(and(eq(conversation.id, id), eq(conversation.userId, session.user.id)));
  return Response.json({ ok: true });
};
