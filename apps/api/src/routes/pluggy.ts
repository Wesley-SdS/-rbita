import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobAccepted } from "../http/job-response";
import { enqueueJob } from "@orbita/core/jobs/queue";
import { log } from "@orbita/core/observability/logger";
import { PluggyErro } from "@orbita/core/pluggy/cliente";
import { acertarSaldoInicial, adicionarItem, ativarConta, AvisoPluggy, removerItem, tokenDeConexao, vincularConta, visaoDoBanco } from "@orbita/core/pluggy/servico";

/**
 * Open Finance pela Pluggy (tela Bancos, em Finanças). Controller fino: a
 * leitura da Pluggy, o reconhecimento de transferência e a gravação moram em
 * `pluggy/`.
 *
 *   GET    /api/pluggy                    bancos, contas e se os saldos batem
 *   POST   /api/pluggy/itens {itemId}     passa a acompanhar um banco (Item ID da Pluggy)
 *   DELETE /api/pluggy/itens?id=          deixa de acompanhar (os lançamentos ficam)
 *   POST   /api/pluggy/vincular           liga uma conta ou cartão do banco a uma conta ou cartão da Órbita
 *   POST   /api/pluggy/ativa              liga/desliga a sincronização de uma conta
 *   POST   /api/pluggy/saldo              acerta o saldo inicial para a conta bater com o banco
 *   POST   /api/pluggy/token              token curto do widget de conexão (novo banco ou renovar um)
 *   POST   /api/pluggy/sincronizar        lê os bancos agora (202 + trabalho)
 *
 * As credenciais (Client ID e Secret) entram por `POST /api/connectors/pluggy/token`.
 */

const Item = z.object({ itemId: z.string().trim().min(10).max(60) });
const Vincular = z.object({ pluggyContaId: z.string().uuid(), contaId: z.string().uuid().nullish(), cartaoId: z.string().uuid().nullish(), nova: z.boolean().optional() });
const Saldo = z.object({ pluggyContaId: z.string().uuid() });
const Token = z.object({ id: z.string().uuid().nullish() });
const Ativa = z.object({ pluggyContaId: z.string().uuid(), ativa: z.boolean() });

function falhou(e: unknown, onde: string): Response {
  // erro do DONO ou da Pluggy (credencial, item inexistente) tem mensagem útil; o resto é nosso
  if (e instanceof AvisoPluggy || e instanceof PluggyErro) return Response.json({ error: e.message }, { status: 400 });
  log.error(`pluggy.${onde}`, { error: e instanceof Error ? e.message : String(e) });
  return Response.json({ error: "Não consegui falar com a Pluggy agora." }, { status: 502 });
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  return Response.json(await visaoDoBanco(session.user.id));
}

export async function POST_ITEM(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Item.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Cole o Item ID da Pluggy." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await adicionarItem(session.user.id, parsed.data.itemId)) });
  } catch (e) {
    return falhou(e, "item");
  }
}

export async function DELETE_ITEM(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  return Response.json({ ok: await removerItem(session.user.id, id.data) });
}

export async function POST_VINCULAR(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Vincular.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.contaId && !parsed.data.cartaoId && !parsed.data.nova)) return Response.json({ error: "Escolha onde lançar ou crie um novo." }, { status: 400 });
  try {
    const { contaId, cartaoId } = parsed.data;
    const r = await vincularConta(session.user.id, parsed.data.pluggyContaId, contaId ? { contaId } : cartaoId ? { cartaoId } : { nova: true });
    // a primeira leitura roda já, pela fila: o dono vê o extrato entrar
    await enqueueJob(session.user.id, { kind: "pluggy.sincronizar", payload: {}, dedupKey: `pluggy-agora:${session.user.id}` }).catch(() => undefined);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return falhou(e, "vincular");
  }
}

export async function POST_ATIVA(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Ativa.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  return Response.json({ ok: await ativarConta(session.user.id, parsed.data.pluggyContaId, parsed.data.ativa) });
}

export async function POST_SALDO(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Saldo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await acertarSaldoInicial(session.user.id, parsed.data.pluggyContaId)) });
  } catch (e) {
    return falhou(e, "saldo");
  }
}

export async function POST_TOKEN(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Token.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  try {
    return Response.json(await tokenDeConexao(session.user.id, parsed.data.id));
  } catch (e) {
    return falhou(e, "token");
  }
}

export async function POST_SINCRONIZAR(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  // dois cliques seguidos não viram duas leituras: o trabalho em andamento responde
  const r = await enqueueJob(session.user.id, { kind: "pluggy.sincronizar", payload: {}, dedupKey: `pluggy-agora:${session.user.id}` });
  return jobAccepted(r.job, r.jaExistia);
}
