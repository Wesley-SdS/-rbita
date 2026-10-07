import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { jobAccepted } from "../http/job-response";
import { enqueueJob } from "@orbita/core/jobs/queue";
import { isOwner } from "@orbita/core/owner";
import { RegraFinanceiraError } from "@orbita/core/finance/operacoes";
import { AcaoDeEmailInvalida, agendarDoEmail, confiarNoBanco, emailsDe, lancarDoEmail, moverEmail, resolverEmail, tarefaDoEmail } from "@orbita/core/emails/servico";

/**
 * Os e-mails separados em ação, úteis e ruído (cartão da tela inicial).
 * Controller fino: a leitura das caixas, a triagem e os efeitos moram em
 * `emails/servico.ts`.
 *
 *   GET  /api/emails?aba=acao|util|ruido   a aba, com a contagem das três
 *   POST /api/emails/atualizar             lê as caixas agora (202 + trabalho)
 *   POST /api/emails/acao                  resolver, reabrir, mover, criar tarefa, lançar, agendar, confiar no banco
 */

const Aba = z.enum(["acao", "util", "ruido"]);

export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const aba = Aba.catch("acao").parse(new URL(req.url).searchParams.get("aba"));
  return Response.json(await emailsDe(session.user.id, aba));
}

export async function POST_ATUALIZAR(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const r = await enqueueJob(session.user.id, { kind: "emails.triar", payload: {}, dedupKey: `emails-agora:${session.user.id}` });
  return jobAccepted(r.job, r.jaExistia);
}

const Acao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("resolver"), id: z.string().uuid() }),
  z.object({ acao: z.literal("reabrir"), id: z.string().uuid() }),
  z.object({ acao: z.literal("mover"), id: z.string().uuid(), categoria: Aba }),
  z.object({ acao: z.literal("tarefa"), id: z.string().uuid(), texto: z.string().max(300).optional() }),
  z.object({ acao: z.literal("lancar"), id: z.string().uuid(), contaId: z.string().uuid() }),
  z.object({ acao: z.literal("agendar"), id: z.string().uuid() }),
  z.object({ acao: z.literal("confiar"), id: z.string().uuid() }),
]);

export async function POST_ACAO(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Acao.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido." }, { status: 400 });
  const userId = session.user.id;
  const a = parsed.data;
  try {
    switch (a.acao) {
      case "resolver":
      case "reabrir":
        await resolverEmail(userId, a.id, a.acao === "resolver");
        return Response.json({ ok: true });
      case "mover":
        await moverEmail(userId, a.id, a.categoria);
        return Response.json({ ok: true });
      case "tarefa":
        return Response.json({ ok: true, tarefaId: await tarefaDoEmail(userId, a.id, a.texto) });
      case "lancar":
        return Response.json({ ok: true, mensagem: await lancarDoEmail(userId, a.id, a.contaId) });
      case "agendar":
        return Response.json({ ok: true, mensagem: await agendarDoEmail(userId, a.id) });
      case "confiar":
        // a lista de bancos vale para a casa inteira: só o dono da instância muda (§6)
        if (!(await isOwner(userId))) return Response.json({ error: "Só o dono da Órbita pode confiar num banco." }, { status: 403 });
        return Response.json({ ok: true, dominio: await confiarNoBanco(userId, a.id) });
    }
  } catch (e) {
    if (e instanceof AcaoDeEmailInvalida || e instanceof RegraFinanceiraError) return Response.json({ error: e.message }, { status: e instanceof AcaoDeEmailInvalida && e.message.includes("não encontrado") ? 404 : 409 });
    throw e;
  }
}
