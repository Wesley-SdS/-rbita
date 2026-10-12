import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { settings } from "@orbita/core/settings/index";
import { isOwner } from "@orbita/core/owner";
import { estadoDasMaos, blocosRegistrados } from "@orbita/core/controle/estado";
import { espelhosRegistrados } from "@orbita/core/controle/espelho";
import { listarSessoes, sessaoPorId } from "@orbita/core/controle/sessao";
import { listarPassosDaTela, miniaturaDoPasso } from "@orbita/core/controle/trilha";
import { resumoDoControle } from "@orbita/core/controle/resumo";
import { pararPorFrase, pararTudo } from "@orbita/core/controle/parar";

/**
 * Controle do PC (PRD-COMPUTADOR-E-NAVEGADOR F6 e F7).
 *
 *   GET  /api/controle/estado                 mãos, extensão, sessão aberta, últimas sessões e os blocos que a tela pode desenhar
 *   GET  /api/controle/passos?sessao=<id>     a trilha de uma sessão (`sessao=avulsos`: os passos sem sessão), sem as imagens
 *   GET  /api/controle/passos/:id/miniatura   a miniatura de um passo, como imagem (só do dono)
 *   POST /api/controle/parar                  para TUDO, agora (o botão da tela e do cartão)
 *   POST /api/controle/falada                 { texto }: a fala do dono na voz; "para" com sessão aberta para tudo
 *
 * Nada aqui muda envelope, site, pasta ou app liberado: isso só muda pela tela
 * de Ajustes (OwnerGuard). Parar é sempre permitido ao dono das sessões.
 */

export async function GET_ESTADO(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const userId = s.user.id;
  const [cfg, maos, aberta, sessoes, dono] = await Promise.all([
    settings.getMany(["controle.ativo", "controle.canais", "controle.telaAtualizarSeg"]),
    estadoDasMaos(),
    resumoDoControle(userId),
    listarSessoes(userId, 30),
    isOwner(userId),
  ]);
  return Response.json({
    ativo: cfg["controle.ativo"],
    canais: cfg["controle.canais"],
    dono,
    maos: maos.maos,
    extensao: maos.extensao,
    espelhos: espelhosRegistrados(),
    blocos: blocosRegistrados(),
    aberta,
    // o ritmo da tela vem daqui: só com sessão ativa ela volta a perguntar
    atualizarEmSeg: aberta?.status === "ativa" ? cfg["controle.telaAtualizarSeg"] : null,
    sessoes: sessoes.map((x) => ({
      id: x.id,
      alvo: x.alvo,
      objetivo: x.objetivo,
      pedidoOriginal: x.pedidoOriginal,
      pedidoLiteral: x.pedidoLiteral,
      apps: x.apps,
      sites: x.sites,
      status: x.status,
      motivo: x.motivo,
      passosUsados: x.passosUsados,
      tetoPassos: x.tetoPassos,
      expiraEm: x.expiraEm,
      canal: x.canal,
      criadaEm: x.criadaEm,
      terminadaEm: x.terminadaEm,
    })),
  });
}

const Sessao = z.union([z.literal("avulsos"), z.string().uuid()]);

export async function GET_PASSOS(req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const p = Sessao.safeParse(new URL(req.url).searchParams.get("sessao"));
  if (!p.success) return Response.json({ error: "Informe a sessão (o id, ou \"avulsos\")." }, { status: 400 });
  if (p.data !== "avulsos" && !(await sessaoPorId(s.user.id, p.data))) return Response.json({ error: "Sessão não encontrada." }, { status: 404 });
  const passos = await listarPassosDaTela(s.user.id, p.data === "avulsos" ? null : p.data, 200);
  return Response.json({
    passos: passos.map((x) => ({
      id: x.id,
      tool: x.tool,
      acao: x.acao,
      alvo: x.alvo,
      risco: x.risco,
      decisao: x.decisao,
      resultado: x.resultado,
      duracaoMs: x.duracaoMs,
      // a imagem vem de /api/controle/passos/:id/miniatura, uma por vez (M10)
      temMiniatura: x.temMiniatura,
      canal: x.canal,
      criadoEm: x.criadoEm,
    })),
  });
}

/**
 * A miniatura de um passo, como imagem de verdade (não JSON): a tela usa
 * `<img loading="lazy">`, o navegador guarda, e a lista da trilha não carrega
 * nenhuma. O passo é procurado pelo id E pelo dono (404 para o de outra conta).
 */
export async function GET_MINIATURA(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = z.string().uuid().safeParse(ctx.params?.id);
  if (!id.success) return Response.json({ error: "Passo inválido." }, { status: 400 });
  const m = await miniaturaDoPasso(s.user.id, id.data);
  const partes = m ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(m) : null;
  if (!partes) return Response.json({ error: "Sem miniatura." }, { status: 404 });
  return new Response(Buffer.from(partes[2]!, "base64"), { headers: { "Content-Type": partes[1]!, "Cache-Control": "private, max-age=86400" } });
}

export async function POST_PARAR(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const r = await pararTudo(s.user.id, "tela");
  return Response.json({ ok: true, sessoes: r.sessoes, propostas: r.propostas, maos: r.maos });
}

const Falada = z.object({ texto: z.string().trim().min(1).max(200) });

/**
 * O navegador repassa só a transcrição da fala DO DONO na voz (nunca o que o
 * modelo disse). Quem decide se é "para" é o código, como no "manda".
 */
export async function POST_FALADA(req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const p = Falada.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "texto obrigatório" }, { status: 400 });
  const r = await pararPorFrase(s.user.id, "voz", p.data.texto);
  return Response.json({ tratado: r !== null, resposta: r?.texto ?? null });
}
