import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversation, message } from "@/lib/db/chat-schema";
import { document, chunk, memory } from "@/lib/db/knowledge-schema";
import { expense } from "@/lib/db/finance-schema";
import { todo } from "@/lib/db/todo-schema";
import { routine, notification } from "@/lib/db/routine-schema";
import { connection } from "@/lib/db/connector-schema";
import { profile } from "@/lib/db/profile-schema";
import { widget } from "@/lib/db/widget-schema";
import { skill, mcpServer } from "@/lib/db/extension-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exporta todos os dados do usuário em JSON (portabilidade — LGPD). */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const uid = session.user.id;

  const [convs, msgs, docs, chunks, mems, exps, todos, rotinas, notifs, conexoes, perfil, widgets, skills, mcps] = await Promise.all([
    db.select().from(conversation).where(eq(conversation.userId, uid)),
    db
      .select({ id: message.id, conversationId: message.conversationId, role: message.role, content: message.content, createdAt: message.createdAt })
      .from(message)
      .innerJoin(conversation, eq(message.conversationId, conversation.id))
      .where(eq(conversation.userId, uid)),
    db.select({ id: document.id, title: document.title, source: document.source, createdAt: document.createdAt }).from(document).where(eq(document.userId, uid)),
    db.select({ id: chunk.id, documentId: chunk.documentId, content: chunk.content }).from(chunk).where(eq(chunk.userId, uid)),
    db.select({ id: memory.id, content: memory.content, createdAt: memory.createdAt }).from(memory).where(eq(memory.userId, uid)),
    db.select().from(expense).where(eq(expense.userId, uid)),
    db.select().from(todo).where(eq(todo.userId, uid)),
    db.select().from(routine).where(eq(routine.userId, uid)),
    db.select().from(notification).where(eq(notification.userId, uid)),
    // metadados dos conectores SEM os tokens (que são criptografados e não devem sair)
    db.select({ provider: connection.provider, accountLabel: connection.accountLabel, scope: connection.scope, createdAt: connection.createdAt }).from(connection).where(eq(connection.userId, uid)),
    db.select().from(profile).where(eq(profile.userId, uid)),
    db.select().from(widget).where(eq(widget.userId, uid)),
    db.select().from(skill).where(eq(skill.userId, uid)),
    // servidores MCP SEM os headers (podem conter segredos)
    db.select({ id: mcpServer.id, name: mcpServer.name, url: mcpServer.url, enabled: mcpServer.enabled, createdAt: mcpServer.createdAt }).from(mcpServer).where(eq(mcpServer.userId, uid)),
  ]);

  const payload = {
    exportadoEm: new Date().toISOString(),
    usuario: { id: session.user.id, nome: session.user.name, email: session.user.email },
    conversas: convs,
    mensagens: msgs,
    documentos: docs,
    trechos: chunks,
    memorias: mems,
    gastos: exps,
    tarefas: todos,
    rotinas: rotinas,
    notificacoes: notifs,
    conectores: conexoes,
    perfil: perfil,
    widgets: widgets,
    skills: skills,
    servidoresMcp: mcps,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="orbita-meus-dados.json"',
    },
  });
}
