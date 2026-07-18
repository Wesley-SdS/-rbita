import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversation, message } from "@/lib/db/chat-schema";
import { document, chunk, memory } from "@/lib/db/knowledge-schema";
import { expense } from "@/lib/db/finance-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exporta todos os dados do usuário em JSON (portabilidade — LGPD). */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const uid = session.user.id;

  const [convs, msgs, docs, chunks, mems, exps] = await Promise.all([
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
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="orbita-meus-dados.json"',
    },
  });
}
