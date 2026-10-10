// Migrada do Next em paridade (apps/web/src/app/api/mcp/route.ts).
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { mcpServer } from "@orbita/db/extension-schema";
import type { RouteCtx } from "../http/web";
import { leituraCacheavel } from "../http/cacheable";
import { sessionOf } from "../http/web-route";
import { assertPublicUrl, SsrfError } from "@orbita/core/net/ssrf";
import { ownerOf } from "../http/owner-route";
import { forgetMcpServer } from "@orbita/core/mcp/client";
import { guardarCabecalhos, nomesDosCabecalhos } from "@orbita/core/mcp/cabecalhos";

// nome de cabeçalho HTTP válido; o valor é o token, com teto para não virar depósito
const Cabecalhos = z
  .record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Nome de cabeçalho inválido"), z.string().min(1).max(4000))
  .refine((h) => Object.keys(h).length <= 10, "No máximo 10 cabeçalhos");

const Body = z.object({
  name: z.string().min(1).max(60),
  url: z.string().url(),
  headers: Cabecalhos.optional(),
});

// "escrita" fica de fora: no registro ela executa sem aprovação, e para código
// de fora ou é leitura, ou o dono aprova (`riscoDaTool`)
const Risco = z.enum(["leitura", "efeito_externo", "perigoso"]);

export async function GET(req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db
    .select({
      id: mcpServer.id,
      name: mcpServer.name,
      url: mcpServer.url,
      enabled: mcpServer.enabled,
      risk: mcpServer.risk,
      toolRisks: mcpServer.toolRisks,
      headers: mcpServer.headers,
      // para a tela dizer por que um servidor está fora e quantas tools ele tem
      toolsCatalog: mcpServer.toolsCatalog,
      catalogAt: mcpServer.catalogAt,
      lastError: mcpServer.lastError,
      lastErrorAt: mcpServer.lastErrorAt,
    })
    .from(mcpServer)
    .where(eq(mcpServer.userId, s.user.id))
    .orderBy(desc(mcpServer.createdAt));
  // o valor do cabeçalho (o token) nunca volta para a tela, só o nome
  const servers = rows.map(({ headers, ...r }) => ({ ...r, cabecalhos: nomesDosCabecalhos(headers) }));
  return leituraCacheavel(req, { servers });
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
    .values({ userId: dono.userId, name: p.data.name, url: p.data.url, headers: guardarCabecalhos(p.data.headers) })
    .returning({ id: mcpServer.id });
  return Response.json({ id: row?.id });
}

// `risk`: "leitura" libera as tools do servidor sem aprovação; qualquer outro
// valor mantém o gate humano (padrão "efeito_externo", decisão da Onda 1).
// `toolRisks`: a escolha por tool, que vence a do servidor; `null` numa tool
// devolve a decisão ao servidor. `headers`: substitui todos (vazio apaga).
const PatchBody = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  risk: Risco.optional(),
  toolRisks: z
    .record(z.string().min(1).max(120), Risco.nullable())
    .refine((r) => Object.keys(r).length <= 300, "Ferramentas demais")
    .optional(),
  headers: Cabecalhos.optional(),
});

export async function PATCH(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = PatchBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const set: { enabled?: boolean; risk?: string; toolRisks?: Record<string, string>; headers?: unknown } = {};
  if (p.data.enabled !== undefined) set.enabled = p.data.enabled;
  if (p.data.risk) set.risk = p.data.risk;
  if (p.data.headers) set.headers = guardarCabecalhos(p.data.headers);
  if (p.data.toolRisks) {
    const [atual] = await db
      .select({ toolRisks: mcpServer.toolRisks })
      .from(mcpServer)
      .where(and(eq(mcpServer.id, p.data.id), eq(mcpServer.userId, dono.userId)))
      .limit(1);
    if (!atual) return Response.json({ error: "Servidor não encontrado" }, { status: 404 });
    const juntos: Record<string, string> = { ...(atual.toolRisks ?? {}) };
    for (const [nome, risco] of Object.entries(p.data.toolRisks)) {
      if (risco) juntos[nome] = risco;
      else delete juntos[nome];
    }
    set.toolRisks = juntos;
  }
  if (!Object.keys(set).length) return Response.json({ error: "Nada para alterar" }, { status: 400 });
  await db.update(mcpServer).set(set).where(and(eq(mcpServer.id, p.data.id), eq(mcpServer.userId, dono.userId)));
  // desligado ou com risco novo: a conexão viva e o que se sabia dele recomeçam
  await forgetMcpServer(p.data.id);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(mcpServer).where(and(eq(mcpServer.id, id), eq(mcpServer.userId, dono.userId)));
  await forgetMcpServer(id);
  return Response.json({ ok: true });
}
