// Nomear locutores após a reunião (B6.5, versão leve). Renomear "Locutor A"
// para o nome real por PESSOA JÁ IDENTIFICADA NA REUNIÃO, não reconhecimento de
// voz entre reuniões (voiceprint) — problema maior, deixado para depois.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { document } from "@orbita/db/knowledge-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

const Body = z.object({
  // "A" -> "Ana": chave é o rótulo do locutor (1-2 chars, como o provedor devolve), valor o nome
  speakers: z.record(z.string().max(4), z.string().min(1).max(80)).refine((o) => Object.keys(o).length <= 20, "Muitos locutores"),
});

/** PUT /api/meeting/:id/speakers — salva os nomes dos locutores de um documento de reunião. */
export async function PUT(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = ctx.params.id;
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const [row] = await db
    .update(document)
    .set({ speakers: parsed.data.speakers })
    .where(and(eq(document.id, id), eq(document.userId, session.user.id)))
    .returning({ id: document.id });
  if (!row) return Response.json({ error: "Documento não encontrado" }, { status: 404 });

  return Response.json({ ok: true, speakers: parsed.data.speakers });
}
