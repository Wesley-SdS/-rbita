// Memórias a confirmar (B4.1): o que a Órbita achou que vale lembrar e ainda
// não guardou. Mesmo espírito da fila de aprovação de ações: ela propõe, o dono
// decide, e o que foi guardado sozinho pode ser desfeito.
import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { decidir, pendentes } from "@orbita/core/memory/candidates";

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  return Response.json({ candidatos: await pendentes(session.user.id) });
}

const Body = z.object({
  id: z.string().uuid(),
  decisao: z.enum(["confirmar", "descartar", "desfazer"]),
  /** o dono pode corrigir o texto antes de confirmar */
  fato: z.string().min(3).max(400).optional(),
});

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const r = await decidir(session.user.id, parsed.data.id, parsed.data.decisao, parsed.data.fato);
  if (!r.ok) return Response.json({ error: r.motivo ?? "não foi possível decidir" }, { status: 400 });
  return Response.json({ ok: true, memoriaId: r.memoriaId ?? null });
}
