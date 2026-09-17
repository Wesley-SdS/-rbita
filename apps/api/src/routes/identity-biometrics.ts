import { z } from "zod";
import { eraseBiometrics } from "@orbita/core/identity/erase";
import type { RouteCtx } from "../http/web";
import { domainError, ownerOf } from "../http/owner-route";

const Query = z.object({ personId: z.string().uuid(), confirm: z.literal("apagar") });

/**
 * DELETE ?personId=&confirm=apagar: apaga toda biometria da pessoa (amostras,
 * assinaturas, referências em câmera e event_log) e revoga o consentimento.
 * O cadastro da pessoa fica. Irreversível: exige a confirmação literal.
 */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const u = new URL(req.url);
  const q = Query.safeParse({ personId: u.searchParams.get("personId"), confirm: u.searchParams.get("confirm") });
  if (!q.success) return Response.json({ error: "Informe personId e confirm=apagar" }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await eraseBiometrics(o.userId, q.data.personId)) });
  } catch (e) {
    return domainError(e);
  }
}
