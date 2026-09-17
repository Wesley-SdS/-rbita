import { z } from "zod";
import { listAudit } from "@orbita/core/identity/people";
import type { RouteCtx } from "../http/web";
import { ownerOf } from "../http/owner-route";

const Query = z.object({ personId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

/** GET: trilha de identidade (identificações com confiança, consultas, consentimentos, apagamentos). */
export async function GET(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const u = new URL(req.url);
  const q = Query.safeParse({ personId: u.searchParams.get("personId") ?? undefined, limit: u.searchParams.get("limit") ?? undefined });
  if (!q.success) return Response.json({ error: "Parâmetros inválidos" }, { status: 400 });
  return Response.json({ audit: await listAudit(o.userId, q.data) });
}
