import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { apagarSenha, cadastrarSenha, listarSenhas, SenhaDeAnexoInvalidaError } from "@orbita/core/anexos/senhas";

/**
 * Senhas de anexo por remetente (PRD de anexos, C5). É o ÚNICO caminho por
 * onde uma senha entra: nunca pelo chat nem pela voz, onde ficaria no
 * histórico e passaria pelo modelo. Nada aqui devolve a senha, nem cifrada.
 *
 *   GET    /api/anexos/senhas          domínios cadastrados (sem a senha)
 *   POST   /api/anexos/senhas          { dominio, senha, rotulo? }
 *   DELETE /api/anexos/senhas?id=      apaga
 */

const Nova = z.object({
  dominio: z.string().trim().min(3).max(253),
  senha: z.string().min(1).max(200),
  rotulo: z.string().trim().max(80).nullish(),
});

export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  return Response.json({ senhas: await listarSenhas(session.user.id) });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Nova.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Informe o remetente (domínio do e-mail) e a senha." }, { status: 400 });
  try {
    return Response.json({ senha: await cadastrarSenha(session.user.id, parsed.data) }, { status: 201 });
  } catch (e) {
    if (e instanceof SenhaDeAnexoInvalidaError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  const ok = await apagarSenha(session.user.id, id.data);
  return ok ? Response.json({ ok }) : Response.json({ error: "Senha não encontrada." }, { status: 404 });
}
