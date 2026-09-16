// Migrada do Next em paridade (apps/web/src/app/api/account/route.ts).
import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { user } from "@orbita/db/auth-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * Apaga a conta e TODOS os dados do usuário (cascade). Direito ao esquecimento (LGPD).
 * Exige confirmação explícita: o corpo deve conter `confirm` igual ao e-mail do
 * usuário, evita exclusão acidental/CSRF de uma ação irreversível.
 */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (!body.confirm || body.confirm.trim().toLowerCase() !== session.user.email.toLowerCase()) {
    return Response.json({ error: "Confirmação inválida: digite seu e-mail para confirmar a exclusão." }, { status: 400 });
  }

  await db.delete(user).where(eq(user.id, session.user.id));
  return Response.json({ ok: true });
}
