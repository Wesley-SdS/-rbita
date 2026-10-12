import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { ownerOf } from "../http/owner-route";
import { settings } from "@orbita/core/settings/index";
import { codigoPendente, gerarCodigo, listarExtensoes, revogarExtensao, VALIDADE_DO_CODIGO_MS } from "@orbita/core/navegador/pareamento";
import { conectadaPelaPonte, derrubarExtensao, extensaoConectada, reenviarSites } from "@orbita/core/navegador/canal";
import { estadoDaPonte, mudarPonte } from "@orbita/core/navegador/ponte";
import { definirSite, listarSites, MODOS, removerSite, SiteInvalidoError } from "@orbita/core/navegador/sites";
import { CATEGORIAS_EDITAVEIS, CATEGORIAS_FIXAS } from "@orbita/core/navegador/categorias";
import { listarRoteiros, removerRoteiro } from "@orbita/core/navegador/roteiros";

/**
 * Chrome do dono (PRD-COMPUTADOR-E-NAVEGADOR B1, B2, B4 e B6). Tudo com
 * OwnerGuard (`ownerOf`): pareamento, sites e roteiros são configuração da
 * casa, e nada disto tem tool (PRD §2.3).
 *
 *   GET    /api/navegador/extensoes          extensões pareadas, se há código valendo e se alguma está conectada
 *   POST   /api/navegador/parear             gera o código de 6 dígitos (5 minutos, uma vez)
 *   DELETE /api/navegador/extensoes/:id      revoga o token e derruba a extensão na hora
 *   GET    /api/navegador/sites              o modo de cada site e as categorias
 *   POST   /api/navegador/sites              { dominio, modo }: cria ou troca
 *   DELETE /api/navegador/sites/:id
 *   GET    /api/navegador/roteiros           os roteiros aprendidos
 *   DELETE /api/navegador/roteiros/:id
 *   POST   /api/navegador/dedicado           { acao: "abrir_login" | "fechar" | "apagar" }: o perfil dedicado com janela, para o dono
 *                                            fazer login; "apagar" fecha e apaga a pasta (cookies e logins)
 *   GET    /api/navegador/ponte              a ponte de native messaging: instalada, segredo, e se a extensão fala por ela agora
 *   POST   /api/navegador/ponte              { acao: "instalar" | "remover" }: o MESMO instalador idempotente do README
 */

const Id = z.string().uuid();

export async function GET_EXTENSOES(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const [lista, extensaoId] = await Promise.all([listarExtensoes(dono.userId), settings.get("navegador.extensaoId")]);
  return Response.json({
    extensaoId,
    conectada: extensaoConectada(dono.userId),
    codigo: codigoPendente(dono.userId),
    extensoes: lista.map((e) => ({ id: e.id, nome: e.nome, versao: e.versao, criadaEm: e.criadaEm, vistaEm: e.vistaEm, revogadaEm: e.revogadaEm })),
  });
}

export async function POST_PAREAR(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const c = gerarCodigo(dono.userId);
  return Response.json({ ...c, validadeSeg: VALIDADE_DO_CODIGO_MS / 1000 });
}

export async function DELETE_EXTENSAO(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const id = Id.safeParse(ctx.params.id);
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  const e = await revogarExtensao(dono.userId, id.data);
  if (!e) return Response.json({ error: "Extensão não encontrada ou já revogada." }, { status: 404 });
  const derrubadas = derrubarExtensao(e.id);
  return Response.json({ ok: true, derrubadas });
}

export async function GET_SITES(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const [sites, cfg] = await Promise.all([listarSites(dono.userId), settings.getMany(["navegador.padraoSite", "navegador.categoriasBloqueadas"])]);
  return Response.json({
    padrao: cfg["navegador.padraoSite"],
    categorias: [...new Set([...cfg["navegador.categoriasBloqueadas"], ...CATEGORIAS_FIXAS])],
    // a Órbita é fixa: aparece como sempre bloqueada e não como opção (I-1)
    categoriasConhecidas: CATEGORIAS_EDITAVEIS,
    categoriasFixas: CATEGORIAS_FIXAS,
    modos: MODOS,
    sites: sites.map((s) => ({ id: s.id, dominio: s.dominio, modo: s.modo, criadoEm: s.criadoEm })),
  });
}

const SiteBody = z.object({ dominio: z.string().trim().min(3).max(253), modo: z.enum(MODOS) });

export async function POST_SITE(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = SiteBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const s = await definirSite(dono.userId, p.data.dominio, p.data.modo);
    await reenviarSites(dono.userId).catch(() => undefined);
    return Response.json({ id: s.id, dominio: s.dominio, modo: s.modo });
  } catch (e) {
    if (e instanceof SiteInvalidoError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE_SITE(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const id = Id.safeParse(ctx.params.id);
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  if (!(await removerSite(dono.userId, id.data))) return Response.json({ error: "Site não encontrado." }, { status: 404 });
  await reenviarSites(dono.userId).catch(() => undefined);
  return Response.json({ ok: true });
}

export async function GET_ROTEIROS(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const lista = await listarRoteiros(dono.userId);
  return Response.json({
    roteiros: lista.map((r) => ({ id: r.id, dominio: r.dominio, intencao: r.intencao, passos: r.passos.length, usos: r.usos, falhas: r.falhas, tokensAprendizado: r.tokensAprendizado, criadoEm: r.criadoEm, usadoEm: r.usadoEm })),
  });
}

export async function DELETE_ROTEIRO(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const id = Id.safeParse(ctx.params.id);
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  if (!(await removerRoteiro(dono.userId, id.data))) return Response.json({ error: "Roteiro não encontrado." }, { status: 404 });
  return Response.json({ ok: true });
}

const DedicadoBody = z.object({ acao: z.enum(["abrir_login", "fechar", "apagar"]) });

export async function POST_DEDICADO(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = DedicadoBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Diga a ação: abrir_login, fechar ou apagar." }, { status: 400 });
  const { abrirDedicado, apagarPerfilDedicado, fecharDedicado } = await import("@orbita/core/navegador/dedicado");
  if (p.data.acao === "fechar") {
    await fecharDedicado("fechado pela tela");
    return Response.json({ ok: true });
  }
  if (p.data.acao === "apagar") {
    // fecha o Chrome dedicado e apaga a pasta: cookies, logins e histórico dele somem
    const r = await apagarPerfilDedicado("apagado pela tela");
    return Response.json({ ok: true, apagada: r.apagada, mensagem: r.apagada ? "Perfil dedicado apagado: os logins de lá sumiram." : "Não havia perfil dedicado para apagar." });
  }
  if (!(await settings.get("navegador.perfilDedicado"))) return Response.json({ error: "Ligue o perfil dedicado em Ajustes primeiro." }, { status: 409 });
  try {
    // com janela: é o dono que faz login ali, nos sites que a Órbita pode usar sozinha
    const c = await abrirDedicado({ visivel: true });
    if (!c.pages().length) await c.newPage();
    return Response.json({ ok: true, mensagem: "O perfil dedicado abriu numa janela. Faça login nos sites que a Órbita pode usar sozinha e feche quando terminar." });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Não consegui abrir o perfil dedicado." }, { status: 502 });
  }
}

export async function GET_PONTE(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  try {
    const e = await estadoDaPonte();
    return Response.json({ ...e, ativa: conectadaPelaPonte(dono.userId) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Não consegui ler o estado da ponte." }, { status: 502 });
  }
}

const PonteBody = z.object({ acao: z.enum(["instalar", "remover"]) });

export async function POST_PONTE(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = PonteBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Diga a ação: instalar ou remover." }, { status: 400 });
  try {
    const e = await mudarPonte(p.data.acao);
    return Response.json({ ...e, ativa: conectadaPelaPonte(dono.userId) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "O instalador da ponte falhou." }, { status: 502 });
  }
}
