import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { finMetaFoto } from "@orbita/db/finance-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { carregar, hojeDoServidor } from "@orbita/core/finance/store";
import { limiaresDaConfig } from "@orbita/core/finance/config";
import { Comando, executar } from "@orbita/core/finance/comandos";
import { RegraFinanceiraError, RepetidoError } from "@orbita/core/finance/operacoes";
import * as visoes from "@orbita/core/finance/visoes";
import { mesDe } from "@orbita/core/finance/calendario";
import { log } from "@orbita/core/observability/logger";
import { proporDitado, lerBoleto, prepararImportacao, csvDoFinanceiro, extratoPdfDosDados } from "@orbita/core/finance/entradas";
import { lerDataUrl } from "@orbita/core/arquivos";
import { lerPdf } from "@orbita/core/ocr/pdf";
import { backupDoDono, restaurarBackup } from "@orbita/core/finance/restauracao";

/**
 * Financeiro (PRD "Freio de Mão"). Controller fino (CLAUDE.md §6): o cálculo
 * mora em `finance/visoes.ts` e a escrita em `finance/comandos.ts`, os
 * MESMOS que as tools do chat e da voz usam.
 *
 *   GET  /api/financas/:vista?mes=YYYY-MM   painel · extrato · contas · cartoes · metas · meta · previsao · historico · cadastros
 *   GET  /api/financas/foto/:id             uma foto de item de meta (fora do painel: pesa)
 *   POST /api/financas                      { tipo: "lancar", … }  (ver `Comando`)
 *
 * Sem cache HTTP de leitura: dinheiro muda a cada lançamento, e a tela já
 * invalida o que precisa depois de cada comando.
 */

const Mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Vista = z.enum(["painel", "extrato", "contas", "cartoes", "metas", "meta", "previsao", "historico", "cadastros"]);

export async function GET(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const userId = session.user.id;
  const vista = Vista.safeParse(ctx.params.vista);
  if (!vista.success) return Response.json({ error: "Tela desconhecida." }, { status: 404 });

  const url = new URL(req.url);
  const hoje = hojeDoServidor();
  const mesPedido = Mes.safeParse(url.searchParams.get("mes"));
  const mes = mesPedido.success ? mesPedido.data : mesDe(hoje);
  const lim = await limiaresDaConfig();
  const dados = await carregar(userId, hoje, lim.mesesSemeados);

  const corpo = await (async () => {
    switch (vista.data) {
      case "painel": return visoes.painel(dados, mes, hoje, lim);
      case "extrato":
        return visoes.extrato(dados, mes, hoje, lim, filtrosDaUrl(url));
      case "contas": return visoes.contas(dados, mes, hoje, lim);
      case "cartoes": return visoes.cartoes(dados, hoje);
      case "metas": return visoes.metas(dados, hoje);
      case "meta": {
        const id = z.string().uuid().safeParse(url.searchParams.get("id"));
        return id.success ? visoes.meta(dados, id.data, hoje) : null;
      }
      case "previsao": return visoes.previsao(dados, hoje, lim);
      case "historico": return visoes.historico(dados, hoje);
      case "cadastros": {
        const [f] = await db.select({ b: sql<number>`coalesce(sum(${finMetaFoto.bytes}),0)` }).from(finMetaFoto).where(eq(finMetaFoto.userId, userId));
        return visoes.cadastros(dados, mes, hoje, Number(f?.b ?? 0));
      }
    }
  })();
  if (corpo === null) return Response.json({ error: "Não encontrado." }, { status: 404 });
  // visão que é lista (cartões, metas) vai em `itens`: espalhar um array no objeto daria {"0": …}
  return Response.json({ hoje, mes, ...(Array.isArray(corpo) ? { itens: corpo } : corpo) });
}

/** Lista das fotos de um item (ids) ou uma foto. Separado do painel porque uma foto pesa mais que o financeiro inteiro. */
export async function GET_FOTOS(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const item = z.string().uuid().safeParse(new URL(req.url).searchParams.get("item"));
  if (!item.success) return Response.json({ error: "Item inválido." }, { status: 400 });
  const fotos = await db
    .select({ id: finMetaFoto.id, dado: finMetaFoto.dado })
    .from(finMetaFoto)
    .where(and(eq(finMetaFoto.userId, session.user.id), eq(finMetaFoto.itemId, item.data)));
  return Response.json({ fotos });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Comando.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try {
    const r = await executar(session.user.id, parsed.data, hojeDoServidor());
    return Response.json(r);
  } catch (e) {
    // repetido é PERGUNTA, não erro: 409 com o que já existe, e a tela confirma
    if (e instanceof RepetidoError) return Response.json({ error: e.message, repetido: true, repetidos: e.repetidos, novos: e.novos }, { status: 409 });
    // erro do DONO (valor zero, conta com lançamentos): mensagem do PRD, 400
    if (e instanceof RegraFinanceiraError) return Response.json({ error: e.message }, { status: 400 });
    log.error("financas.comando", { tipo: parsed.data.tipo, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Não consegui salvar agora." }, { status: 500 });
  }
}

const Entrada = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("ditado"), texto: z.string().trim().min(1).max(4000) }),
  z.object({ acao: z.literal("boleto"), linha: z.string().max(200) }),
  // PDF de boleto é pequeno (uma página); o teto é defesa
  z.object({ acao: z.literal("boleto_pdf"), pdf: z.string().max(8_000_000) }),
  z.object({ acao: z.literal("extrato"), conteudo: z.string().min(1).max(5_000_000) }),
]);

/**
 * POST /api/financas/entrada: entende o ditado, lê boleto e extrato. Não grava
 * nada; devolve as propostas para o dono conferir, e é o `POST /api/financas`
 * que grava (§8.1.4, §8.4 tela 2). Rápido o bastante para rodar na requisição:
 * sem LLM e sem OCR (o boleto usa a camada de texto do PDF).
 */
export async function POST_ENTRADA(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Entrada.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  const hoje = hojeDoServidor();
  const dados = await carregar(session.user.id, hoje, (await limiaresDaConfig()).mesesSemeados);
  try {
    const e = parsed.data;
    switch (e.acao) {
      case "ditado": return Response.json({ propostas: proporDitado(dados, e.texto, hoje) });
      case "boleto": return Response.json(lerBoleto(dados, { linha: e.linha }, hoje));
      case "boleto_pdf": {
        const arquivo = lerDataUrl(e.pdf);
        if (!arquivo) return Response.json({ error: "Não consegui abrir o arquivo." }, { status: 400 });
        let texto: string;
        try {
          texto = (await lerPdf(new Uint8Array(arquivo.bytes))).map((p) => p.texto).join(String.fromCharCode(10));
        } catch {
          return Response.json({ error: "Não consegui ler esse PDF. Cole a linha digitável no campo acima." }, { status: 400 });
        }
        return Response.json(lerBoleto(dados, { textoDoPdf: texto }, hoje));
      }
      case "extrato": return Response.json(prepararImportacao(dados, e.conteudo));
    }
  } catch (err) {
    if (err instanceof RegraFinanceiraError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

/** Os filtros do extrato na query, validados (os mesmos da tela e do PDF). */
function filtrosDaUrl(url: URL) {
  const natureza = z.enum(["despesa", "receita"]).safeParse(url.searchParams.get("natureza"));
  return {
    busca: url.searchParams.get("q")?.slice(0, 120) ?? null,
    natureza: natureza.success ? natureza.data : null,
    categoriaId: z.string().uuid().safeParse(url.searchParams.get("categoria")).data ?? null,
    onde: z.string().regex(/^(conta|cartao):[0-9a-f-]{36}$/).safeParse(url.searchParams.get("onde")).data ?? null,
  };
}

/** GET /api/financas/exportar?formato=csv|backup|pdf: arquivo para baixar (§9.1, §9.2; pdf = o extrato do mês com os filtros da tela). */
export async function GET_EXPORTAR(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const formato = new URL(req.url).searchParams.get("formato");
  const hoje = hojeDoServidor();
  const dados = await carregar(session.user.id, hoje, (await limiaresDaConfig()).mesesSemeados);
  if (formato === "csv") {
    return new Response(csvDoFinanceiro(dados), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="lancamentos.csv"', "Cache-Control": "no-store" },
    });
  }
  if (formato === "pdf") {
    const url = new URL(req.url);
    const mes = Mes.safeParse(url.searchParams.get("mes")).data ?? mesDe(hoje);
    const pdf = await extratoPdfDosDados(dados, mes, hoje, await limiaresDaConfig(), filtrosDaUrl(url), session.user.name ?? null);
    return new Response(Buffer.from(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="extrato-${mes}.pdf"`, "Cache-Control": "no-store" },
    });
  }
  if (formato === "backup") {
    return new Response(JSON.stringify(await backupDoDono(session.user.id, hoje), null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="backup-financas.json"', "Cache-Control": "no-store" },
    });
  }
  return Response.json({ error: "Formato desconhecido." }, { status: 400 });
}

/**
 * POST /api/financas/restaurar { backup }: substitui TUDO pelo backup (§9.4).
 * A tela pede confirmação antes; aqui a validação roda antes de apagar.
 */
export async function POST_RESTAURAR(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const corpo = (await req.json().catch(() => null)) as { backup?: unknown } | null;
  try {
    return Response.json(await restaurarBackup(session.user.id, corpo?.backup));
  } catch (e) {
    if (e instanceof RegraFinanceiraError) return Response.json({ error: e.message }, { status: 400 });
    log.error("financas.restaurar", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Não consegui restaurar esse backup." }, { status: 500 });
  }
}
