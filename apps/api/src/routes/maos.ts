import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { ownerOf } from "../http/owner-route";
import { log } from "@orbita/core/observability/logger";
import { MaosError, tokenConfere } from "@orbita/core/maos/client";
import { tratarAvisoDasMaos } from "@orbita/core/maos/servico";
import { appsAbertosParaATela, classificarParaATela, comandosParaATela, pastasParaATela } from "@orbita/core/maos/tela";
import { SHELLS } from "@orbita/core/terminal/servico";

/**
 * As mãos do Windows (PRD-COMPUTADOR-E-NAVEGADOR frente A).
 *
 *   POST /api/maos/aviso         o apps/maos avisa que JÁ parou ou pausou (atalho, mouse do dono). Sem sessão:
 *                                autentica pelo MAOS_TOKEN (`x-orbita-maos`), e pedido com Origin é recusado
 *                                (página web nenhuma fala aqui, nem com o token)
 *   GET  /api/maos/pastas        as pastas liberadas, com o caminho de verdade e se existem (bloco "pastas")
 *   GET  /api/maos/apps          os apps abertos agora e quais já saem ocultos (bloco "apps_ocultos")
 *   GET  /api/maos/comandos      a lista de comandos de leitura e os terminais instalados (bloco "comandos")
 *   POST /api/maos/classificar   { comando, shell? }: o risco que o classificador daria, SEM rodar (bloco "comandos")
 *
 * As listas em si mudam por `PUT /api/settings` (OwnerGuard). Nada disto tem tool (PRD §2.3).
 */

const Aviso = z.object({
  id: z.string().min(8).max(64),
  tipo: z.enum(["parar", "pausar"]),
  origem: z.string().max(60),
  motivo: z.string().max(300).optional(),
  sessaoId: z.string().max(80).nullish(),
  em: z.number().optional(),
});

export async function POST_AVISO(req: Request, _ctx: RouteCtx) {
  // o apps/maos manda sem Origin (urllib); navegador sempre manda em POST de outra origem
  if (req.headers.get("origin")) return Response.json({ error: "origem não permitida" }, { status: 403 });
  if (!tokenConfere(req.headers.get("x-orbita-maos"))) return Response.json({ error: "não autorizado" }, { status: 401 });
  const p = Aviso.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "aviso inválido" }, { status: 400 });
  log.info("maos.aviso", { tipo: p.data.tipo, origem: p.data.origem });
  const r = await tratarAvisoDasMaos(p.data);
  return Response.json({ ok: true, ...r });
}

export async function GET_PASTAS(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  return Response.json(await pastasParaATela());
}

export async function GET_APPS(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  try {
    return Response.json(await appsAbertosParaATela());
  } catch (e) {
    return Response.json({ error: e instanceof MaosError ? e.message : "Não consegui falar com o serviço do Windows." }, { status: 503 });
  }
}

export async function GET_COMANDOS(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  return Response.json(await comandosParaATela());
}

const Classificar = z.object({
  comando: z.string().trim().min(1).max(4000),
  shell: z.enum(SHELLS).nullish(),
});

export async function POST_CLASSIFICAR(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const p = Classificar.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Diga o comando (até 4000 caracteres)." }, { status: 400 });
  try {
    return Response.json(await classificarParaATela(p.data.comando, p.data.shell));
  } catch (e) {
    // sem terminal instalado ou liberado: a frase diz qual
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
