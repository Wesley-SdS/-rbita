// Nomear locutores após a reunião (B6.5, versão leve). Renomear "Locutor A"
// para o nome real por PESSOA JÁ IDENTIFICADA NA REUNIÃO, não reconhecimento de
// voz entre reuniões (voiceprint) — problema maior, deixado para depois.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { document } from "@orbita/db/knowledge-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { isOwner } from "@orbita/core/owner";
import { enrollFromMeetingRef } from "@orbita/core/identity/voice";
import { log } from "@orbita/core/observability/logger";

const Body = z.object({
  // "A" -> "Ana": chave é o rótulo do locutor (1-2 chars, como o provedor devolve), valor o nome
  speakers: z.record(z.string().max(4), z.string().min(1).max(80)).refine((o) => Object.keys(o).length <= 20, "Muitos locutores"),
  // Onda 9: ligar a etiqueta a uma pessoa e, com consentimento, usar a fala
  // como amostra. `corrigido` = a Órbita tinha sugerido outra pessoa (correção ensina).
  links: z
    .record(z.string().max(4), z.object({ personId: z.string().uuid(), ref: z.string().uuid().optional(), usarComoAmostra: z.boolean().default(false), corrigido: z.boolean().default(false) }))
    .refine((o) => Object.keys(o).length <= 20, "Muitos locutores")
    .optional(),
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

  // amostra só com consentimento (checado em enrollFromMeetingRef); falha numa
  // etiqueta não desfaz o nome salvo, só volta o motivo para a tela
  const amostras: Record<string, string> = {};
  if (parsed.data.links && (await isOwner(session.user.id))) {
    for (const [label, l] of Object.entries(parsed.data.links)) {
      if (!l.usarComoAmostra || !l.ref) continue;
      try {
        await enrollFromMeetingRef(session.user.id, l.personId, l.ref, l.corrigido ? "correcao" : "reuniao");
        amostras[label] = "cadastrada";
      } catch (e) {
        amostras[label] = e instanceof Error ? e.message : "falhou";
        log.warn("meeting.amostra_falhou", { label, error: amostras[label] });
      }
    }
  }
  return Response.json({ ok: true, speakers: parsed.data.speakers, amostras });
}
