import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { lerQuadro, moverCard } from "@orbita/core/quadro/servico";
import { QUADROS, type QualQuadro } from "@orbita/core/quadro/regras";

/**
 * O quadro da Adalink na tela. Controller fino: a leitura e o mover moram em
 * `core/quadro/`.
 *
 *   GET  /api/quadro?qual=chamados|gestao[&fresco=1]
 *   POST /api/quadro/mover {qual, cardId, colunaId}
 *
 * O POST é o ARRASTAR do dono na tela: o gesto dele é a aprovação (como o
 * botão da fila). Pelo chat e pela voz o caminho é outro, a tool `mover_card`,
 * que só propõe.
 */

const Qual = z.enum(QUADROS as [QualQuadro, ...QualQuadro[]]);

export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const qual = Qual.safeParse(url.searchParams.get("qual") ?? "chamados");
  if (!qual.success) return Response.json({ error: "Quadro desconhecido." }, { status: 400 });
  try {
    return Response.json(await lerQuadro(session.user.id, qual.data, { fresco: url.searchParams.get("fresco") === "1" }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Não consegui ler o quadro." }, { status: 502 });
  }
}

const Mover = z.object({ qual: Qual, cardId: z.string().min(1).max(80), colunaId: z.string().min(1).max(80) });

export async function POST_MOVER(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const p = Mover.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Pedido inválido." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await moverCard(session.user.id, p.data.qual, p.data.cardId, p.data.colunaId)) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Não consegui mover o card." }, { status: 502 });
  }
}
