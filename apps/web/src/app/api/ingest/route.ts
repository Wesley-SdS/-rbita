import { z } from "zod";
import { embedTexts } from "@orbita/llm";
import { db } from "@/lib/db";
import { document, chunk } from "@/lib/db/knowledge-schema";
import { chunkText } from "@/lib/rag/chunk";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(200000),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const { title, content } = parsed.data;
  const chunks = chunkText(content);
  if (!chunks.length) return Response.json({ error: "Conteúdo vazio" }, { status: 400 });

  const userId = session.user.id;
  const embeddings = await embedTexts(chunks);

  const [doc] = await db.insert(document).values({ userId, title, source: "text" }).returning();
  if (!doc) return Response.json({ error: "Falha ao criar documento" }, { status: 500 });

  await db.insert(chunk).values(
    chunks.map((c, i) => ({
      documentId: doc.id,
      userId,
      content: c,
      idx: i,
      embedding: embeddings[i]!,
    })),
  );

  return Response.json({ documentId: doc.id, title, chunks: chunks.length });
}
