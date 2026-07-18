import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/auth-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Apaga a conta e TODOS os dados do usuário (cascade). Direito ao esquecimento (LGPD). */
export async function DELETE() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  await db.delete(user).where(eq(user.id, session.user.id));
  return Response.json({ ok: true });
}
