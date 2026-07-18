import { z } from "zod";
import { ingestDocument } from "@/lib/rag/ingest";
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

  const res = await ingestDocument(session.user.id, parsed.data.title, parsed.data.content, "text");
  if (!res.chunks) return Response.json({ error: "Conteúdo vazio" }, { status: 400 });
  return Response.json({ title: parsed.data.title, ...res });
}
