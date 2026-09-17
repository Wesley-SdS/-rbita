// Migrada do Next em paridade (apps/web/src/app/api/skills/route.ts).
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { embedText } from "@orbita/llm";
import { db } from "@orbita/db";
import { skill } from "@orbita/db/extension-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { ownerOf } from "../http/owner-route";

/** Vetor da skill p/ roteamento semântico (nome + palavras-chave + instruções). */
async function skillEmbedding(name: string, keywords: string | undefined, instructions: string): Promise<number[] | null> {
  try {
    return await embedText(`${name}. ${keywords ?? ""}. ${instructions}`.slice(0, 1500), "document");
  } catch {
    return null; // embedding é best-effort; roteamento cai para keyword se faltar
  }
}

const Body = z.object({ name: z.string().min(1).max(80), instructions: z.string().min(1).max(4000), keywords: z.string().max(300).optional() });

export async function GET(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db.select().from(skill).where(eq(skill.userId, s.user.id)).orderBy(desc(skill.createdAt));
  return Response.json({ skills: rows });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const embedding = await skillEmbedding(p.data.name, p.data.keywords, p.data.instructions);
  const [row] = await db.insert(skill).values({ userId: dono.userId, ...p.data, embedding }).returning({ id: skill.id });
  return Response.json({ id: row?.id });
}

/** Liga/desliga uma skill. */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const { id, enabled } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.update(skill).set({ enabled: enabled !== false }).where(and(eq(skill.id, id), eq(skill.userId, dono.userId)));
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(skill).where(and(eq(skill.id, id), eq(skill.userId, dono.userId)));
  return Response.json({ ok: true });
}
