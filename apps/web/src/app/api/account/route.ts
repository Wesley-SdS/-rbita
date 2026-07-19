import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/auth-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Apaga a conta e TODOS os dados do usuário (cascade). Direito ao esquecimento (LGPD).
 * Exige confirmação explícita: o corpo deve conter `confirm` igual ao e-mail do
 * usuário — evita exclusão acidental/CSRF de uma ação irreversível.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (!body.confirm || body.confirm.trim().toLowerCase() !== session.user.email.toLowerCase()) {
    return Response.json({ error: "Confirmação inválida: digite seu e-mail para confirmar a exclusão." }, { status: 400 });
  }

  await db.delete(user).where(eq(user.id, session.user.id));
  return Response.json({ ok: true });
}
