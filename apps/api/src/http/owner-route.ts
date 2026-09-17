import { isOwner } from "@orbita/core/owner";
import type { RouteCtx } from "./web";

/**
 * Para rotas na assinatura Web: 401 sem sessão, 403 se não for o dono. Pessoas
 * da casa, consentimento e biometria são dados da CASA, e a casa é do dono
 * (CLAUDE.md §1): outra conta logada não cadastra nem apaga ninguém.
 */
export async function ownerOf(ctx: RouteCtx): Promise<{ userId: string } | Response> {
  if (!ctx.user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!(await isOwner(ctx.user.id))) return Response.json({ error: "Somente o dono desta instância gerencia pessoas e biometria." }, { status: 403 });
  return { userId: ctx.user.id };
}

/** Erro de domínio com `status` vira resposta; o resto sobe (a ponte loga e devolve 500). */
export function domainError(e: unknown): Response {
  if (e instanceof Error && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return Response.json({ error: e.message }, { status: (e as { status: number }).status });
  }
  throw e;
}
