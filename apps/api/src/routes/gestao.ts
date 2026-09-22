import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@orbita/db";
import { usageEvent } from "@orbita/db/usage-schema";
import { porDia, resumirUso, type LinhaDeUso } from "@orbita/core/usage/resumo";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { leituraCacheavel } from "../http/cacheable";

/**
 * GET /api/gestao — o consumo da casa, para a tela de gestão.
 *
 * Só o que é DESTE usuário. Mesmo sendo uma casa de um dono só, o filtro por
 * `userId` vale a regra de sempre: as contas de teste desta instância são
 * usuários de verdade, e foi uma delas que rodou a rotina de 1 minuto.
 */
const PERIODOS: Record<string, number> = { hoje: 1, semana: 7, mes: 30, trimestre: 90 };

export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const dias = PERIODOS[url.searchParams.get("periodo") ?? "semana"] ?? 7;
  const desde = new Date();
  desde.setDate(desde.getDate() - (dias - 1));
  desde.setHours(0, 0, 0, 0);

  const linhas = (await db
    .select({
      fluxo: usageEvent.fluxo,
      referencia: usageEvent.referencia,
      provider: usageEvent.provider,
      modelo: usageEvent.modelo,
      unidade: usageEvent.unidade,
      entrada: usageEvent.entrada,
      saida: usageEvent.saida,
      custoUsd: usageEvent.custoUsd,
      cobranca: usageEvent.cobranca,
      duracaoMs: usageEvent.duracaoMs,
      erro: usageEvent.erro,
      createdAt: usageEvent.createdAt,
    })
    .from(usageEvent)
    .where(and(eq(usageEvent.userId, session.user.id), gte(usageEvent.createdAt, desde)))
    .orderBy(desc(usageEvent.createdAt))) as LinhaDeUso[];

  // As últimas chamadas em si, para a pessoa conferir uma linha específica
  // ("o que foi esse gasto às 3 da manhã?"). Sem isto, a tela só dá totais, e
  // total não explica nada quando aparece um número estranho.
  const ultimas = linhas.slice(0, 50);

  return leituraCacheavel(req, {
    periodoDias: dias,
    resumo: resumirUso(linhas),
    porDia: porDia(linhas, dias),
    ultimas,
  });
}
