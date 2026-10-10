import { and, eq, inArray, like, lt } from "drizzle-orm";
import { db } from "@orbita/db";
import { user } from "@orbita/db/auth-schema";
import { comigoAviso } from "@orbita/db/comigo-schema";
import { mcpServer } from "@orbita/db/extension-schema";
import { chamarFerramentaMcpPorAutomacao, lerFerramentaMcp } from "../mcp/client";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { notifyUser } from "../routines/run";
import { atividadesComigo, classificarChamados, deveComentar, ocorrencias, quaisAvisar, textoDoAvisoComigo, textoDoComentario, tipoDaOcorrencia, type Atividade, type Chamado, type ChamadoBruto, type ChamadosClassificados, type RegraDoPrazo } from "./regras";

/**
 * O que está com o dono na gestão e na central de chamados da Adalink, lido
 * pelos servidores MCP que ele cadastrou em Extensões (`lerFerramentaMcp`, só
 * ferramentas de leitura). A tela inicial, a tool e o laço de avisos leem
 * daqui; as regras de "atrasado" e "sem tratativa" moram em `regras.ts`.
 */

export interface ComigoDoDono {
  /** o que está configurado e ligado (sem servidor, a parte nem aparece na tela) */
  partes: { gestao: boolean; tickets: boolean };
  atividades: Atividade[];
  chamados: ChamadosClassificados;
  /** a parte que não respondeu, dita em gente */
  falhas: string[];
  lidoEm: string;
}

const STATUS_ABERTOS = ["open", "in_progress", "waiting"] as const;
const POR_PAGINA = 50;
const MAX_PAGINAS = 10;

async function lerChamados(userId: string, servidor: string): Promise<ChamadoBruto[]> {
  const todos: ChamadoBruto[] = [];
  for (const status of STATUS_ABERTOS) {
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const r = (await lerFerramentaMcp(userId, servidor, "tickets_list", { status, page, limit: POR_PAGINA })) as { tickets?: ChamadoBruto[]; totalPages?: number } | null;
      todos.push(...(r?.tickets ?? []));
      if (!r?.totalPages || page >= r.totalPages) break;
    }
  }
  return todos;
}

async function servidoresLigados(userId: string): Promise<Set<string>> {
  const rows = await db.select({ name: mcpServer.name }).from(mcpServer).where(and(eq(mcpServer.userId, userId), eq(mcpServer.enabled, true)));
  return new Set(rows.map((r) => r.name));
}

async function meuNome(userId: string): Promise<string> {
  const configurado = (await settings.get("comigo.meuNome")).trim();
  if (configurado) return configurado;
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return u?.name ?? "";
}

const emCache = new Map<string, { em: number; valor: ComigoDoDono }>();

/** `fresco`: ignora o cache (o laço de avisos precisa do estado de agora). */
export async function comigoDe(userId: string, opts: { fresco?: boolean } = {}): Promise<ComigoDoDono> {
  const validadeMs = (await settings.get("comigo.cacheSegundos")) * 1000;
  const guardado = emCache.get(userId);
  if (!opts.fresco && guardado && Date.now() - guardado.em < validadeMs) return guardado.valor;

  const [cfg, ligados, nome] = await Promise.all([
    settings.getMany(["comigo.servidorGestao", "comigo.servidorTickets", "connectors.fusoHorario", "comigo.pertoPercentual", "comigo.pertoHoras"]),
    servidoresLigados(userId),
    meuNome(userId),
  ]);
  const regra: RegraDoPrazo = { fuso: cfg["connectors.fusoHorario"] || "America/Sao_Paulo", percentualPerto: cfg["comigo.pertoPercentual"], horasPerto: cfg["comigo.pertoHoras"] };
  const gestao = cfg["comigo.servidorGestao"].trim();
  const tickets = cfg["comigo.servidorTickets"].trim();
  const partes = { gestao: Boolean(gestao) && ligados.has(gestao), tickets: Boolean(tickets) && ligados.has(tickets) };
  const agora = new Date();
  const falhas: string[] = [];

  const [atividades, chamados] = await Promise.all([
    partes.gestao
      ? lerFerramentaMcp(userId, gestao, "get_my_day").then((d) => atividadesComigo(d, agora, regra)).catch((e) => {
          falhas.push(`a gestão (${e instanceof Error ? e.message : "sem resposta"})`);
          return [] as Atividade[];
        })
      : Promise.resolve([] as Atividade[]),
    partes.tickets
      ? lerChamados(userId, tickets).then((b) => classificarChamados(b, nome, agora, regra)).catch((e) => {
          falhas.push(`os chamados (${e instanceof Error ? e.message : "sem resposta"})`);
          return { comigo: [], semTratativa: [], comDevAtrasados: [], todos: [] } as ChamadosClassificados;
        })
      : Promise.resolve({ comigo: [], semTratativa: [], comDevAtrasados: [], todos: [] } as ChamadosClassificados),
  ]);

  const valor: ComigoDoDono = { partes, atividades, chamados, falhas, lidoEm: agora.toISOString() };
  // leitura com falha não fica guardada: a próxima abertura tenta de novo
  if (!falhas.length) emCache.set(userId, { em: Date.now(), valor });
  return valor;
}

/**
 * Uma volta de avisos. O fato novo (atividade ou chamado que chegou para o
 * dono, chamado que passou a atrasar) é gravado ANTES de avisar, pela chave.
 * A primeira vez de cada tipo só guarda, sem avisar: ligar isto não pode virar
 * um aviso com tudo que já existia. A exceção é o que já está ATRASADO, que
 * avisa logo. Parte que falhou não conta: a ausência dela não é "sumiu".
 */
export async function vigiarComigo(userId: string): Promise<{ novas: number; falhas: string[] }> {
  const c = await comigoDe(userId, { fresco: true });
  if (!c.partes.gestao && !c.partes.tickets) return { novas: 0, falhas: [] };
  const cfg = await settings.getMany(["connectors.fusoHorario", "comigo.avisarChamadoNovo", "comigo.chamadoNovoHoras"]);
  const nome = await meuNome(userId);
  const agora = new Date();
  const novoDesde = cfg["comigo.avisarChamadoNovo"] ? new Date(agora.getTime() - cfg["comigo.chamadoNovoHoras"] * 3_600_000) : null;
  const todas = ocorrencias({ atividades: c.atividades, chamados: c.chamados }, cfg["connectors.fusoHorario"], { meuNome: nome, novoDesde }).map((o) => ({ ...o, chave: o.chave.slice(0, 200) }));

  // o tipo já visto é lido ANTES de gravar: a primeira volta de cada tipo só guarda
  const tiposJaVistos = new Set<string>();
  for (const t of new Set(todas.map(tipoDaOcorrencia))) {
    const [algum] = await db.select({ chave: comigoAviso.chave }).from(comigoAviso).where(and(eq(comigoAviso.userId, userId), like(comigoAviso.chave, `${t}:%`))).limit(1);
    if (algum) tiposJaVistos.add(t);
  }
  const recemGravadas = new Set<string>();
  for (const o of todas) {
    const [nova] = await db.insert(comigoAviso).values({ userId, chave: o.chave, vistoEm: agora }).onConflictDoNothing().returning({ chave: comigoAviso.chave });
    if (nova) recemGravadas.add(o.chave);
  }
  if (todas.length) {
    await db.update(comigoAviso).set({ vistoEm: agora }).where(and(eq(comigoAviso.userId, userId), inArray(comigoAviso.chave, todas.map((o) => o.chave))));
  }
  const novas = quaisAvisar(todas, recemGravadas, tiposJaVistos);

  // chegou para o dono AGORA (e não na primeira volta, que só guarda o que já existia)
  if (tiposJaVistos.has("chamado")) {
    const chegaram = c.chamados.comigo.filter((t) => recemGravadas.has(`chamado:${t.id}`.slice(0, 200)));
    if (chegaram.length) await comentarRecebidos(userId, chegaram, nome);
  }

  if (novas.length && (await settings.get("comigo.avisar"))) {
    const { titulo, corpo } = textoDoAvisoComigo(novas);
    await notifyUser(userId, titulo, corpo, null, { destino: "/app" });
  }
  if (c.falhas.length) log.warn("comigo.parte_falhou", { userId, falhas: c.falhas });
  return { novas: novas.length, falhas: c.falhas };
}

/**
 * O comentário de "recebi" nos chamados que acabaram de chegar para o dono,
 * se ele ligou (`comigo.comentarAoReceber`). A chave `comentou:<id>` é gravada
 * ANTES de comentar: cair no meio deixa no pior caso um comentário por fazer,
 * nunca dois no mesmo chamado (comentário público duplicado não se desfaz).
 * Se o comentário falhar, o dono é avisado, em vez de achar que saiu.
 */
async function comentarRecebidos(userId: string, chamados: Chamado[], nome: string): Promise<void> {
  const cfg = await settings.getMany(["comigo.comentarAoReceber", "comigo.comentarioTexto", "comigo.comentarioInterno", "comigo.servidorTickets"]);
  if (!cfg["comigo.comentarAoReceber"] || !cfg["comigo.comentarioTexto"].trim()) return;
  const falhas: string[] = [];
  for (const t of chamados.filter((x) => deveComentar(x, nome))) {
    const [primeira] = await db.insert(comigoAviso).values({ userId, chave: `comentou:${t.id}`.slice(0, 200) }).onConflictDoNothing().returning({ chave: comigoAviso.chave });
    if (!primeira) continue;
    try {
      await chamarFerramentaMcpPorAutomacao(userId, cfg["comigo.servidorTickets"].trim(), "tickets_comment", {
        ticket: t.id || t.codigo,
        body: textoDoComentario(cfg["comigo.comentarioTexto"], t),
        internal: cfg["comigo.comentarioInterno"],
      });
      log.info("comigo.comentou", { userId, chamado: t.codigo });
    } catch (e) {
      falhas.push(t.codigo);
      log.warn("comigo.comentario_falhou", { userId, chamado: t.codigo, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  if (falhas.length) {
    await notifyUser(userId, "Não consegui comentar no chamado", `Tentei avisar que você está analisando ${falhas.join(", ")}, mas a central recusou. Vale comentar à mão.`, null, { destino: "/app" });
  }
}

/** Donos com o servidor da gestão ou dos chamados ligado. */
export async function donosComComigo(): Promise<string[]> {
  const cfg = await settings.getMany(["comigo.servidorGestao", "comigo.servidorTickets"]);
  const nomes = [cfg["comigo.servidorGestao"].trim(), cfg["comigo.servidorTickets"].trim()].filter(Boolean);
  if (!nomes.length) return [];
  const rows = await db.select({ userId: mcpServer.userId }).from(mcpServer).where(and(eq(mcpServer.enabled, true), inArray(mcpServer.name, nomes)));
  return [...new Set(rows.map((r) => r.userId))];
}

/** O que sumiu da lista há mais de `comigo.diasGuardar` é esquecido (se voltar, avisa de novo). */
export async function podarComigo(userId: string): Promise<void> {
  const dias = await settings.get("comigo.diasGuardar");
  await db.delete(comigoAviso).where(and(eq(comigoAviso.userId, userId), lt(comigoAviso.vistoEm, new Date(Date.now() - dias * 86_400_000))));
}
