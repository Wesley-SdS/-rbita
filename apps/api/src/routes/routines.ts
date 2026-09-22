// Migrada do Next em paridade (apps/web/src/app/api/routines/route.ts).
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { routine } from "@orbita/db/routine-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { settings } from "@orbita/core/settings/index";

const Body = z.object({
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(2000),
  // o piso REAL vem da config (`routines.minIntervalMinutes`), conferido
  // abaixo: aqui só o limite absoluto do tipo
  intervalMinutes: z.number().int().min(1).max(43200).default(1440),
});

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select()
    .from(routine)
    .where(eq(routine.userId, session.user.id))
    .orderBy(desc(routine.createdAt));
  return Response.json({ routines: rows });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error?.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  // Uma rotina é uma chamada de modelo COM ferramentas, a cada volta. Sem este
  // piso dava para cadastrar "a cada 1 minuto" sem nenhum aviso — foi o que
  // aconteceu em 22/09/2026, e ela rodou 356 vezes antes de alguém reparar.
  const minimo = await settings.get("routines.minIntervalMinutes");
  if (parsed.data.intervalMinutes < minimo) {
    return Response.json(
      { error: `O intervalo mínimo é de ${minimo} minutos. Cada execução consulta um modelo, então rodar mais vezes que isso vira gasto contínuo. O mínimo se muda em Ajustes.` },
      { status: 400 },
    );
  }

  const [row] = await db
    .insert(routine)
    .values({ userId: session.user.id, ...parsed.data })
    .returning({ id: routine.id });
  return Response.json({ id: row?.id });
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(routine).where(and(eq(routine.id, id), eq(routine.userId, session.user.id)));
  return Response.json({ ok: true });
}
