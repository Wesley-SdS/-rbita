import { z } from "zod";
import { ConsentInputSchema, currentTerm, recordConsent, revokeConsent } from "@orbita/core/identity/people";
import type { RouteCtx } from "../http/web";
import { domainError, ownerOf } from "../http/owner-route";

/** GET: o termo vigente (texto + versão) que a tela mostra antes do aceite. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  return Response.json({ termo: await currentTerm() });
}

/** POST: registra o consentimento (quem, quando, o quê). Menor só pelo responsável. */
export async function POST(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const parsed = ConsentInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    return Response.json(await recordConsent(o.userId, o.userId, parsed.data));
  } catch (e) {
    return domainError(e);
  }
}

/** DELETE ?id=: revoga. A biometria já cadastrada se apaga à parte (DELETE /api/identity/biometrics). */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  try {
    await revokeConsent(o.userId, id.data);
    return Response.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
