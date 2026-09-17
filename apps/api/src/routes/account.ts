// Migrada do Next em paridade (apps/web/src/app/api/account/route.ts).
import { eraseAccount } from "@orbita/core/account/data";
import { getOwnerId, invalidateOwnerCache } from "@orbita/core/owner";
import { log } from "@orbita/core/observability/logger";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * Apaga a conta e TODOS os dados do usuário. Direito ao esquecimento (LGPD).
 * Exige confirmação explícita: o corpo deve conter `confirm` igual ao e-mail do
 * usuário, evita exclusão acidental/CSRF de uma ação irreversível.
 *
 * A lista do que apagar sai do schema (`eraseAccount`), incluindo o `event_log`,
 * que não tem FK e antes ficava para trás (RV.6).
 */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (!body.confirm || body.confirm.trim().toLowerCase() !== session.user.email.toLowerCase()) {
    return Response.json({ error: "Confirmação inválida: digite seu e-mail para confirmar a exclusão." }, { status: 400 });
  }

  // garante a linha de posse ANTES de apagar: se esta conta é a dona e a posse
  // ainda não foi gravada, o FK set null precisa existir para deixar a instância órfã
  await getOwnerId();
  const r = await eraseAccount(session.user.id);
  // se era o dono, a posse fica órfã (FK set null) e ninguém é promovido sozinho
  invalidateOwnerCache();
  log.info("account.apagada", { userId: session.user.id, limpezaExplicita: r.limpezaExplicita });
  return Response.json({ ok: true });
}
