// Migrada do Next em paridade (apps/web/src/app/api/mcp/route.ts).
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { mcpServer } from "@orbita/db/extension-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { assertPublicUrl, SsrfError } from "@orbita/core/net/ssrf";
import { ownerOf } from "../http/owner-route";

const Body = z.object({
  name: z.string().min(1).max(60),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export async function GET(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select({ id: mcpServer.id, name: mcpServer.name, url: mcpServer.url, enabled: mcpServer.enabled, risk: mcpServer.risk })
    .from(mcpServer)
    .where(eq(mcpServer.userId, s.user.id))
    .orderBy(desc(mcpServer.createdAt));
  return Response.json({ servers: rows });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message }, { status: 400 });
  // defesa SSRF: rejeita URL que aponta para rede interna já no cadastro
  try {
    await assertPublicUrl(p.data.url);
  } catch (e) {
    if (e instanceof SsrfError) return Response.json({ error: `URL não permitida (${e.message})` }, { status: 400 });
    throw e;
  }
  const [row] = await db
    .insert(mcpServer)
    .values({ userId: dono.userId, name: p.data.name, url: p.data.url, headers: p.data.headers ?? null })
    .returning({ id: mcpServer.id });
  return Response.json({ id: row?.id });
}

// `risk`: "leitura" libera as tools do servidor sem aprovação; qualquer outro
// valor mantém o gate humano (padrão "efeito_externo", decisão da Onda 1).
const PatchBody = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  risk: z.enum(["leitura", "escrita", "efeito_externo", "perigoso"]).optional(),
});

export async function PATCH(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = PatchBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const set: { enabled?: boolean; risk?: string } = {};
  if (p.data.enabled !== undefined) set.enabled = p.data.enabled;
  if (p.data.risk) set.risk = p.data.risk;
  if (!Object.keys(set).length) return Response.json({ error: "Nada para alterar" }, { status: 400 });
  await db.update(mcpServer).set(set).where(and(eq(mcpServer.id, p.data.id), eq(mcpServer.userId, dono.userId)));
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(mcpServer).where(and(eq(mcpServer.id, id), eq(mcpServer.userId, dono.userId)));
  return Response.json({ ok: true });
}
