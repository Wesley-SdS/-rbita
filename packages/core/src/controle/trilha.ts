import { and, desc, eq, getTableColumns, isNull, lt, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { controlePasso, type ControlePasso } from "@orbita/db/controle-schema";
import type { ToolRisk } from "../tools/registry";
import { imagemDaSaida, semImagem } from "./imagem";
import { mascararNaTrilha } from "./segredos";
import { cortarSemPartirToken } from "../terminal/saida";

/**
 * TRILHA DE CADA PASSO (PRD F3). Toda chamada das tools sensíveis passa por
 * aqui, pela guarda do registro: não depende de a tool lembrar. Fora do
 * registro (o laço delegado ao Claude, uma ordem interna às mãos), quem age usa
 * `comTrilha`, que faz o mesmo: grava ANTES, executa, atualiza depois.
 *
 * O que se grava da entrada é só o que identifica o alvo, curto (`alvoDaEntrada`):
 * nunca o texto a digitar, o conteúdo de um arquivo ou a página. A trilha é
 * para o dono entender o que a Órbita fez, não uma segunda cópia dos dados.
 */

export type DecisaoDoPasso = "executando" | "executado" | "vetado" | "recusado" | "na_fila" | "falhou";

/** Campos curtos que dizem ONDE a ação mexe. Qualquer outro campo da entrada fica fora. */
const CAMPOS_DO_ALVO = ["alvo", "app", "janela", "elemento", "ref", "url", "dominio", "aba", "pasta", "caminho", "comando", "shell", "tecla", "atalho", "objetivo", "id"] as const;
const TAM_CAMPO = 200;
/** Quanto do texto passa pela máscara antes do corte final (folga para os `[segredo]` que encurtam o texto). */
const JANELA_DA_MASCARA = 2000;

function curto(v: unknown): unknown {
  if (typeof v === "string") {
    // mascara ANTES de cortar: o corte partiria um token no meio, e a metade escaparia da máscara.
    // Mas só a janela que pode aparecer (com folga): mascarar um campo enorme inteiro para guardar 200 caracteres é trabalho jogado fora
    const m = mascararNaTrilha(cortarSemPartirToken(v, JANELA_DA_MASCARA));
    return m.length > TAM_CAMPO ? `${m.slice(0, TAM_CAMPO)}…` : m;
  }
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 20).map(curto);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 12)) {
      if (k === "texto" || k === "conteudo" || k === "senha") continue;
      o[k] = curto(x);
    }
    return o;
  }
  return undefined;
}

/** O alvo da ação, para a trilha. O texto a digitar entra só como TAMANHO. Puro. */
export function alvoDaEntrada(entrada: unknown): Record<string, unknown> {
  if (!entrada || typeof entrada !== "object") return {};
  const e = entrada as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS_DO_ALVO) if (e[k] !== undefined) out[k] = curto(e[k]);
  if (typeof e.texto === "string") out.texto_caracteres = e.texto.length;
  if (typeof e.conteudo === "string") out.conteudo_caracteres = e.conteudo.length;
  return out;
}

/** A ação dentro da tool (`clicar`, `digitar`), quando a entrada diz. Puro. */
export function acaoDaEntrada(entrada: unknown): string | null {
  const a = entrada && typeof entrada === "object" ? (entrada as Record<string, unknown>).acao : undefined;
  return typeof a === "string" ? a.slice(0, 60) : null;
}

/** Uma linha do que a tool devolveu, sem a imagem e sem passar de 300 caracteres. Puro. */
export function resumoDoResultado(saida: unknown): string {
  const s = semImagem(saida);
  // a frase do resultado também fica guardada: um erro que repete o comando com o token não leva o token.
  // Corta ANTES de mascarar (G2 da auditoria): o JSON inteiro de uma saída de 400 mil caracteres passava
  // pela máscara para guardar 300. O corte não parte token (`cortarSemPartirToken`), então a máscara
  // enxerga inteiro tudo o que sobra.
  const linha = (t: string) => mascararNaTrilha(cortarSemPartirToken(t, JANELA_DA_MASCARA)).slice(0, 300);
  if (typeof s === "string") return linha(s);
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    for (const k of ["erro", "mensagem", "resumo", "motivo"]) if (typeof o[k] === "string" && o[k]) return linha(o[k] as string);
    try {
      return linha(JSON.stringify(s));
    } catch {
      return "";
    }
  }
  return s === undefined ? "" : linha(String(s));
}

export interface NovoPasso {
  userId: string;
  tool: string;
  risco: ToolRisk;
  decisao: DecisaoDoPasso;
  entrada?: unknown;
  sessaoId?: string | null;
  acaoId?: string | null;
  canal?: string | null;
  resultado?: string | null;
}

/**
 * O `resultado` como pode ficar guardado: TODO resultado passa por aqui, não só
 * o que veio de `resumoDoResultado`. A recusa da guarda grava o motivo e a
 * exceção grava `e.message` direto, e uma mensagem de erro que repete o
 * comando levava o token inteiro para o banco, a tela e o export (I11 da
 * auditoria de 11/10/2026). Mascarar de novo o que já veio mascarado não muda nada.
 */
function resultadoGuardado(r: string | null | undefined): string | null {
  return r ? mascararNaTrilha(cortarSemPartirToken(r, JANELA_DA_MASCARA)).slice(0, 300) : null;
}

export async function registrarPasso(p: NovoPasso): Promise<string> {
  const [row] = await db
    .insert(controlePasso)
    .values({
      userId: p.userId,
      sessaoId: p.sessaoId ?? null,
      acaoId: p.acaoId ?? null,
      tool: p.tool,
      acao: acaoDaEntrada(p.entrada),
      alvo: alvoDaEntrada(p.entrada),
      risco: p.risco,
      decisao: p.decisao,
      resultado: resultadoGuardado(p.resultado),
      canal: p.canal ?? null,
    })
    .returning({ id: controlePasso.id });
  return row!.id;
}

export async function atualizarPasso(id: string, p: { decisao: DecisaoDoPasso; resultado?: string | null; duracaoMs?: number | null; miniatura?: string | null; sessaoId?: string | null }): Promise<void> {
  await db
    .update(controlePasso)
    .set({
      decisao: p.decisao,
      ...(p.resultado !== undefined ? { resultado: resultadoGuardado(p.resultado) } : {}),
      ...(p.duracaoMs !== undefined ? { duracaoMs: p.duracaoMs } : {}),
      ...(p.miniatura !== undefined ? { miniatura: p.miniatura } : {}),
      ...(p.sessaoId !== undefined ? { sessaoId: p.sessaoId } : {}),
      atualizadoEm: new Date(),
    })
    .where(eq(controlePasso.id, id));
}

/** O passo que ficou NA FILA esperando esta proposta, para a execução aprovada continuar o mesmo registro. */
export async function passoDaProposta(userId: string, acaoId: string): Promise<ControlePasso | null> {
  const [row] = await db
    .select()
    .from(controlePasso)
    .where(and(eq(controlePasso.userId, userId), eq(controlePasso.acaoId, acaoId), eq(controlePasso.decisao, "na_fila")))
    .orderBy(desc(controlePasso.criadoEm))
    .limit(1);
  return row ?? null;
}

/** A miniatura da saída, só se o dono deixou guardar (e só se for pequena). */
export function miniaturaDaSaida(saida: unknown, guardar: boolean): string | null {
  if (!guardar) return null;
  const m = imagemDaSaida(saida)?.miniatura;
  return m && m.startsWith("data:image/") && m.length <= 200_000 ? m : null;
}

export interface PassoComTrilha {
  userId: string;
  tool: string;
  risco: ToolRisk;
  entrada?: unknown;
  sessaoId?: string | null;
  canal?: string | null;
}

/**
 * Executa `fn` com trilha: passo gravado ANTES (`executando`), atualizado para
 * `executado` ou `falhou` com a duração. Para quem age FORA do registro (o
 * laço delegado, uma ordem interna às mãos). Erro é relançado depois de gravado.
 */
export async function comTrilha<T>(p: PassoComTrilha, fn: () => Promise<T>): Promise<T> {
  const id = await registrarPasso({ ...p, decisao: "executando" });
  const comecou = Date.now();
  try {
    const r = await fn();
    await atualizarPasso(id, { decisao: "executado", resultado: resumoDoResultado(r), duracaoMs: Date.now() - comecou });
    return r;
  } catch (e) {
    await atualizarPasso(id, { decisao: "falhou", resultado: e instanceof Error ? e.message : String(e), duracaoMs: Date.now() - comecou }).catch(() => undefined);
    throw e;
  }
}

/** Passos de uma sessão (ou os avulsos, sem sessão), do mais novo ao mais velho. */
export async function listarPassos(userId: string, sessaoId: string | null, limite = 200): Promise<ControlePasso[]> {
  return db
    .select()
    .from(controlePasso)
    .where(and(eq(controlePasso.userId, userId), sessaoId ? eq(controlePasso.sessaoId, sessaoId) : isNull(controlePasso.sessaoId)))
    .orderBy(desc(controlePasso.criadoEm))
    .limit(limite);
}

/**
 * Os passos para a TELA da trilha, sem a miniatura: só dizem se há uma. Com a
 * imagem, eram até 200 data URLs de 200 KB por resposta (40 MB), e a tela
 * pergunta a cada poucos segundos com a sessão ativa (M10 da auditoria). A
 * imagem vem de `miniaturaDoPasso`, uma por vez e só quando aparece.
 */
const { miniatura: _semMiniatura, ...colunasDaTela } = getTableColumns(controlePasso);
export async function listarPassosDaTela(userId: string, sessaoId: string | null, limite = 200): Promise<(Omit<ControlePasso, "miniatura"> & { temMiniatura: boolean })[]> {
  return db
    .select({ ...colunasDaTela, temMiniatura: sql<boolean>`${controlePasso.miniatura} is not null` })
    .from(controlePasso)
    .where(and(eq(controlePasso.userId, userId), sessaoId ? eq(controlePasso.sessaoId, sessaoId) : isNull(controlePasso.sessaoId)))
    .orderBy(desc(controlePasso.criadoEm))
    .limit(limite);
}

/** A miniatura de UM passo do dono, ou null. */
export async function miniaturaDoPasso(userId: string, passoId: string): Promise<string | null> {
  const [row] = await db
    .select({ miniatura: controlePasso.miniatura })
    .from(controlePasso)
    .where(and(eq(controlePasso.id, passoId), eq(controlePasso.userId, userId)))
    .limit(1);
  return row?.miniatura ?? null;
}

/** O último passo, para o cartão "Órbita no controle". */
export async function ultimoPasso(userId: string, sessaoId: string): Promise<ControlePasso | null> {
  return (await listarPassos(userId, sessaoId, 1))[0] ?? null;
}

/** Retenção (`controle.retencaoDias`): passos mais velhos somem. Zero guarda para sempre. */
export async function purgarPassos(dias: number): Promise<number> {
  if (!dias || dias <= 0) return 0;
  const corte = new Date(Date.now() - dias * 86_400_000);
  const r = await db.delete(controlePasso).where(lt(controlePasso.criadoEm, corte)).returning({ id: controlePasso.id });
  return r.length;
}
