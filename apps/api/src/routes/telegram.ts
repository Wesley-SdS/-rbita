import { z } from "zod";
import { listPeople } from "@orbita/core/identity/people";
import { BotInvalido, conectarBot, criarLinkDeConvite, desconectarBot } from "@orbita/core/telegram/bot";
import { TelegramErro } from "@orbita/core/telegram/api";
import * as store from "@orbita/core/telegram/store";
import type { RouteCtx } from "../http/web";
import { ownerOf } from "../http/owner-route";

/**
 * Telegram, o canal da própria Órbita (PRD-TELEGRAM). Tudo aqui é tela do
 * DONO: ligar o bot, convidar a si mesmo e as pessoas da casa, ver quem fala
 * com ele e bloquear. O token nunca volta para a tela.
 */

const erroDoBot = (e: unknown) => {
  if (e instanceof BotInvalido) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof TelegramErro) return Response.json({ error: "O Telegram não respondeu agora. Tente de novo em instantes." }, { status: 502 });
  throw e;
};

/** GET /api/telegram — estado do bot e quem está vinculado. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const [bot, contatos, pessoas] = await Promise.all([store.botDe(dono.userId), store.listarContatos(dono.userId), listPeople(dono.userId).catch(() => [])]);
  const nomeDaPessoa = new Map(pessoas.map((p) => [p.id, p.name]));
  return Response.json({
    conectado: Boolean(bot),
    bot: bot ? { username: bot.username, ultimoContatoEm: bot.ultimoContatoEm, ultimoErro: bot.ultimoErro } : null,
    contatos: contatos.map((c) => ({ id: c.id, nome: c.nome, username: c.username, papel: c.papel, pessoa: c.personId ? nomeDaPessoa.get(c.personId) ?? null : null, vinculadoEm: c.vinculadoEm })),
    pessoas: pessoas.map((p) => ({ id: p.id, nome: p.name })),
  });
}

const Conectar = z.object({ token: z.string().trim().min(20).max(120) });

/** POST /api/telegram/conectar — confere o token no Telegram e grava cifrado. */
export async function POST_CONECTAR(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = Conectar.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Cole o token do bot (o @BotFather mostra ao criar)." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await conectarBot(dono.userId, p.data.token)) });
  } catch (e) {
    return erroDoBot(e);
  }
}

/** POST /api/telegram/desconectar — tira o bot; as conversas ficam. */
export async function POST_DESCONECTAR(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  await desconectarBot(dono.userId);
  return Response.json({ ok: true });
}

const Convite = z.discriminatedUnion("papel", [z.object({ papel: z.literal("dono") }), z.object({ papel: z.literal("pessoa"), personId: z.string().uuid() })]);

/** POST /api/telegram/convite — link de uso único para vincular o dono ou uma pessoa da casa. */
export async function POST_CONVITE(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = Convite.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Escolha para quem é o convite." }, { status: 400 });
  if (p.data.papel === "pessoa") {
    const pessoas = await listPeople(dono.userId);
    if (!pessoas.some((x) => x.id === (p.data as { personId: string }).personId)) return Response.json({ error: "Pessoa não encontrada." }, { status: 404 });
  }
  try {
    return Response.json(await criarLinkDeConvite(dono.userId, p.data.papel, p.data.papel === "pessoa" ? p.data.personId : null));
  } catch (e) {
    return erroDoBot(e);
  }
}

const PatchContato = z.object({ papel: z.enum(["bloqueado", "desconhecido"]) });

/**
 * PATCH /api/telegram/contatos/:id — bloquear ou desvincular. Vincular só pelo
 * convite: é o convite que prova que aquela conta do Telegram é da pessoa.
 */
export async function PATCH_CONTATO(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const id = z.string().uuid().safeParse(ctx.params.id);
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  const p = PatchContato.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Papel inválido." }, { status: 400 });
  const c = await store.atualizarContato(dono.userId, id.data, { papel: p.data.papel, personId: null });
  if (!c) return Response.json({ error: "Contato não encontrado" }, { status: 404 });
  return Response.json({ ok: true });
}

/** DELETE /api/telegram/contatos/:id — apaga o contato e a conversa dele com o bot. */
export async function DELETE_CONTATO(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const id = z.string().uuid().safeParse(ctx.params.id);
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  if (!(await store.apagarContato(dono.userId, id.data))) return Response.json({ error: "Contato não encontrado" }, { status: 404 });
  return Response.json({ ok: true });
}
