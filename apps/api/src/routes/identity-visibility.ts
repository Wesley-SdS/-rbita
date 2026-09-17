import { setVisibility, VisibilityInputSchema } from "@orbita/core/identity/people";
import type { RouteCtx } from "../http/web";
import { domainError, ownerOf } from "../http/owner-route";

/** PUT: quem pode perguntar sobre quem. `allowed: null` volta à regra padrão. */
export async function PUT(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const parsed = VisibilityInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    await setVisibility(o.userId, parsed.data);
    return Response.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
