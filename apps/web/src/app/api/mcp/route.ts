import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpServer } from "@/lib/db/extension-schema";
import { getSession } from "@/lib/session";
import { assertPublicUrl, SsrfError } from "@/lib/net/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(60),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select({ id: mcpServer.id, name: mcpServer.name, url: mcpServer.url, enabled: mcpServer.enabled })
    .from(mcpServer)
    .where(eq(mcpServer.userId, s.user.id))
    .orderBy(desc(mcpServer.createdAt));
  return Response.json({ servers: rows });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
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
    .values({ userId: s.user.id, name: p.data.name, url: p.data.url, headers: p.data.headers ?? null })
    .returning({ id: mcpServer.id });
  return Response.json({ id: row?.id });
}

const PatchBody = z.object({ id: z.string().uuid(), enabled: z.boolean().optional() });

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const p = PatchBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });
  await db.update(mcpServer).set({ enabled: p.data.enabled !== false }).where(and(eq(mcpServer.id, p.data.id), eq(mcpServer.userId, s.user.id)));
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(mcpServer).where(and(eq(mcpServer.id, id), eq(mcpServer.userId, s.user.id)));
  return Response.json({ ok: true });
}
