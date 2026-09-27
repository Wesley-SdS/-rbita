import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import {
  expense, finPerfil, finConta, finCartao, finCategoria, finLancamento, finCompromisso, finPagamentoFatura,
  finDivida, finDividaPagamento, finDividaRolagem, finMeta, finMetaItem, finMetaFoto, finAtalho, finRegra, finDesfazer,
  type FinCategoria, type FinCompromisso,
} from "@orbita/db/finance-schema";
import { mesDe, partes, type Ymd } from "./calendario";
import { semearRecorrentes } from "./recorrentes";
import { CATEGORIAS_DE_ENTRADA, CATEGORIAS_DE_SAIDA, CONTAS_INICIAIS, corDaVez } from "./padroes";
import type { NovoLancamento } from "./operacoes";
import { paraMotorCompromissos, type DadosFinanceiros } from "./dados";
export { paraMotor, type DadosFinanceiros } from "./dados";

/**
 * O banco do financeiro. Toda consulta filtra por `userId` (CLAUDE.md §6),
 * inclusive as de escrita: um id adivinhado não mexe no dinheiro de outra
 * pessoa da casa.
 *
 * O financeiro de uma pessoa cabe inteiro na memória (alguns milhares de
 * linhas numa vida de uso), então a leitura carrega TUDO e os números saem
 * das funções puras (`mes.ts`, `cartao.ts`…). É o que garante que painel,
 * chat e voz digam o mesmo número: ninguém soma no SQL por fora do motor.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

// ── primeira abertura ──────────────────────────────────────────────────────

/**
 * Cria o financeiro de quem abre pela primeira vez (PRD §3.13) e copia o que
 * havia na tabela antiga: gasto vira lançamento na primeira conta, conta a
 * pagar/receber vira compromisso, a categoria em texto vira categoria de
 * verdade. Roda uma vez por dono (a linha de perfil é a trava).
 */
export async function garantirInicio(userId: string): Promise<void> {
  const [perfil] = await db.select({ userId: finPerfil.userId }).from(finPerfil).where(eq(finPerfil.userId, userId));
  if (perfil) return;
  await db.transaction((tx) => semearInicio(tx, userId, true));
}

/**
 * Perfil, contas e categorias iniciais. `legado` copia a tabela antiga; o
 * "apagar tudo" passa false, senão o financeiro antigo voltaria sozinho logo
 * depois de o dono pedir para zerar.
 */
export async function semearInicio(tx: Tx, userId: string, legado: boolean): Promise<void> {
  // corrida entre duas abas abrindo ao mesmo tempo: quem inserir primeiro semeia
  const criado = await tx.insert(finPerfil).values({ userId, legadoImportadoEm: legado ? null : new Date() }).onConflictDoNothing().returning({ userId: finPerfil.userId });
  if (!criado.length) return;
  const contas = await tx
    .insert(finConta)
    .values(CONTAS_INICIAIS.map((c, i) => ({ userId, nome: c.nome, tipo: c.tipo, cor: c.cor, ordem: i })))
    .returning();
  const nomes = [
    ...CATEGORIAS_DE_SAIDA.map((nome) => ({ nome, tipo: "despesa" as const })),
    ...CATEGORIAS_DE_ENTRADA.map((nome) => ({ nome, tipo: "receita" as const })),
  ];
  const categorias = await tx
    .insert(finCategoria)
    .values(nomes.map((c, i) => ({ userId, nome: c.nome, tipo: c.tipo, cor: corDaVez(i), ordem: i })))
    .returning();
  if (!legado) return;
  await importarLegado(tx, userId, contas[0]!.id, categorias);
  await tx.update(finPerfil).set({ legadoImportadoEm: new Date() }).where(eq(finPerfil.userId, userId));
}

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function importarLegado(tx: Tx, userId: string, contaId: string, categorias: FinCategoria[]): Promise<void> {
  const antigos = await tx.select().from(expense).where(eq(expense.userId, userId));
  if (!antigos.length) return;
  const porNome = new Map(categorias.map((c) => [`${c.tipo}:${c.nome.toLowerCase()}`, c.id]));
  let usadas = categorias.length;
  const categoriaDe = async (nome: string | null, tipo: "despesa" | "receita") => {
    const n = nome?.trim();
    if (!n) return porNome.get(`${tipo}:${tipo === "despesa" ? "outros gastos" : "outras entradas"}`) ?? null;
    const chave = `${tipo}:${n.toLowerCase()}`;
    if (porNome.has(chave)) return porNome.get(chave)!;
    const [nova] = await tx.insert(finCategoria).values({ userId, nome: n, tipo, cor: corDaVez(usadas++), ordem: usadas }).returning({ id: finCategoria.id });
    porNome.set(chave, nova!.id);
    return nova!.id;
  };
  for (const e of antigos) {
    const tipo = e.kind === "receivable" ? "receita" : "despesa";
    const categoriaId = await categoriaDe(e.category, tipo);
    if (e.kind === "expense") {
      await tx.insert(finLancamento).values({ userId, tipo: "despesa", data: ymdLocal(e.createdAt), valor: e.amountCents, descricao: e.description, categoriaId, contaId, criadoEm: e.createdAt });
      continue;
    }
    const vencimento = ymdLocal(e.dueDate ?? e.createdAt);
    const [c] = await tx
      .insert(finCompromisso)
      .values({ userId, direcao: e.kind === "payable" ? "pagar" : "receber", descricao: e.description, valor: e.amountCents, vencimento, categoriaId, contaId, status: e.paid ? "quitado" : "aberto", quitadoEm: e.paid ? vencimento : null })
      .returning({ id: finCompromisso.id });
    if (e.paid) {
      const [l] = await tx
        .insert(finLancamento)
        .values({ userId, tipo, data: vencimento, valor: e.amountCents, descricao: e.description, categoriaId, contaId, fixo: true, compromissoId: c!.id })
        .returning({ id: finLancamento.id });
      await tx.update(finCompromisso).set({ lancamentoId: l!.id }).where(eq(finCompromisso.id, c!.id));
    }
  }
}

// ── leitura ────────────────────────────────────────────────────────────────

/**
 * Carrega o financeiro inteiro, depois de garantir o início e de semear as
 * contas fixas até N meses à frente (§4.4). Semear na LEITURA, e não num cron,
 * é o que o PRD faz e tem uma razão: quem abre o app em novembro sem ter
 * aberto em outubro precisa ver as contas de novembro já ali.
 */
export async function carregar(userId: string, hoje: Ymd, mesesSemeados: number): Promise<DadosFinanceiros> {
  await garantirInicio(userId);
  const compromissos = await semearComTrava(userId, hoje, mesesSemeados);

  const [perfil, contas, cartoes, categorias, lancamentos, pagamentosFatura, dividas, pagDividas, rolagens, metas, itens, fotos, atalhos, regras] = await Promise.all([
    db.select().from(finPerfil).where(eq(finPerfil.userId, userId)),
    db.select().from(finConta).where(eq(finConta.userId, userId)).orderBy(asc(finConta.ordem), asc(finConta.nome)),
    db.select().from(finCartao).where(eq(finCartao.userId, userId)).orderBy(asc(finCartao.ordem), asc(finCartao.nome)),
    db.select().from(finCategoria).where(eq(finCategoria.userId, userId)).orderBy(asc(finCategoria.ordem)),
    db.select().from(finLancamento).where(eq(finLancamento.userId, userId)).orderBy(desc(finLancamento.data), desc(finLancamento.criadoEm)),
    db.select().from(finPagamentoFatura).where(eq(finPagamentoFatura.userId, userId)),
    db.select().from(finDivida).where(eq(finDivida.userId, userId)).orderBy(asc(finDivida.criadoEm)),
    db.select().from(finDividaPagamento).where(eq(finDividaPagamento.userId, userId)).orderBy(desc(finDividaPagamento.data)),
    db.select().from(finDividaRolagem).where(eq(finDividaRolagem.userId, userId)),
    db.select().from(finMeta).where(eq(finMeta.userId, userId)).orderBy(asc(finMeta.criadoEm)),
    db.select().from(finMetaItem).where(eq(finMetaItem.userId, userId)).orderBy(asc(finMetaItem.ordem)),
    // só a contagem: a foto em si é lida sob demanda, fora do painel
    db.select({ itemId: finMetaFoto.itemId }).from(finMetaFoto).where(eq(finMetaFoto.userId, userId)),
    db.select().from(finAtalho).where(eq(finAtalho.userId, userId)).orderBy(asc(finAtalho.ordem)),
    db.select().from(finRegra).where(eq(finRegra.userId, userId)).orderBy(asc(finRegra.ordem)),
  ]);
  const fotosPorItem = new Map<string, number>();
  for (const f of fotos) fotosPorItem.set(f.itemId, (fotosPorItem.get(f.itemId) ?? 0) + 1);
  return {
    renda: perfil[0]?.renda ?? 0,
    teto: perfil[0]?.teto ?? 0,
    boasVindasVistas: perfil[0]?.boasVindasVistas ?? false,
    contas,
    cartoes,
    categorias,
    lancamentos,
    compromissos: compromissos.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0)),
    pagamentosFatura,
    dividas: dividas.map((d) => ({ ...d, pagamentos: pagDividas.filter((p) => p.dividaId === d.id), rolagens: rolagens.filter((r) => r.dividaId === d.id) })),
    metas: metas.map((m) => ({ ...m, itens: itens.filter((i) => i.metaId === m.id).map((i) => ({ ...i, fotos: fotosPorItem.get(i.id) ?? 0 })) })),
    atalhos,
    regras,
  };
}

/**
 * Semeia as contas fixas sob uma trava por dono (advisory lock da transação).
 * A tela pede painel e cadastros EM PARALELO; sem a trava, as duas leituras
 * viam o mesmo estado e as duas criavam o aluguel de novembro. Dentro da
 * trava a lista é relida, então a segunda leitura já vê o que a primeira criou.
 */
async function semearComTrava(userId: string, hoje: Ymd, mesesSemeados: number): Promise<FinCompromisso[]> {
  const rapida = await db.select().from(finCompromisso).where(eq(finCompromisso.userId, userId));
  // caminho comum: nada a semear, nem abre transação
  if (!semearRecorrentes(paraMotorCompromissos(rapida), hoje, mesesSemeados, () => "x").length) return rapida;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"fin-semear:" + userId}))`);
    const atuais = await tx.select().from(finCompromisso).where(eq(finCompromisso.userId, userId));
    const novos = semearRecorrentes(paraMotorCompromissos(atuais), hoje, mesesSemeados, () => crypto.randomUUID());
    if (!novos.length) return atuais;
    const gravados = await tx
      .insert(finCompromisso)
      .values(novos.map((c) => ({ id: c.id, userId, direcao: c.direcao, descricao: c.descricao, valor: c.valor, vencimento: c.vencimento, recorrencia: c.recorrencia, serieId: c.serieId ?? null, diaMes: c.diaMes ?? null, categoriaId: c.categoriaId ?? null, contaId: c.contaId ?? null })))
      .returning();
    return [...atuais, ...gravados];
  });
}

// ── escrita ────────────────────────────────────────────────────────────────

/** Grava lançamentos e devolve os ids, na ordem. */
export async function inserirLancamentos(ex: Exec, userId: string, ls: NovoLancamento[]): Promise<string[]> {
  if (!ls.length) return [];
  const rows = await ex.insert(finLancamento).values(ls.map((l) => ({ ...l, userId }))).returning({ id: finLancamento.id });
  return rows.map((r) => r.id);
}

/** Guarda o que uma ação criou, para "desfaz" (tela) ou "desfaz o último" (voz). */
export async function registrarDesfazer(ex: Exec, userId: string, descricao: string, lancamentoIds: string[]): Promise<string | null> {
  if (!lancamentoIds.length) return null;
  const [r] = await ex.insert(finDesfazer).values({ userId, descricao, lancamentoIds }).returning({ id: finDesfazer.id });
  return r?.id ?? null;
}

/**
 * Desfaz uma ação (ou a última, sem id). Só apaga lançamentos que ainda
 * existem e são do dono; o registro some junto, então desfazer duas vezes
 * não apaga nada a mais.
 */
export async function desfazer(userId: string, id?: string | null): Promise<{ descricao: string; apagados: number } | null> {
  return db.transaction(async (tx) => {
    const [r] = id
      ? await tx.select().from(finDesfazer).where(and(eq(finDesfazer.userId, userId), eq(finDesfazer.id, id)))
      : await tx.select().from(finDesfazer).where(eq(finDesfazer.userId, userId)).orderBy(desc(finDesfazer.criadoEm)).limit(1);
    if (!r) return null;
    const apagados = await tx.delete(finLancamento).where(and(eq(finLancamento.userId, userId), inArray(finLancamento.id, r.lancamentoIds))).returning({ id: finLancamento.id });
    await tx.delete(finDesfazer).where(eq(finDesfazer.id, r.id));
    return { descricao: r.descricao, apagados: apagados.length };
  });
}

/**
 * Categoria que o sistema precisa (Transferência, Pagamento de fatura,
 * Projeto · X…): acha pelo nome e tipo, ou cria com a próxima cor (§3.14).
 */
export async function categoriaDoSistema(ex: Exec, userId: string, def: { nome: string; tipo: "despesa" | "receita" }): Promise<string> {
  const todas = await ex.select().from(finCategoria).where(eq(finCategoria.userId, userId));
  const achada = todas.find((c) => c.tipo === def.tipo && c.nome.toLowerCase() === def.nome.toLowerCase());
  if (achada) return achada.id;
  const [nova] = await ex.insert(finCategoria).values({ userId, nome: def.nome, tipo: def.tipo, cor: corDaVez(todas.length), ordem: todas.length }).returning({ id: finCategoria.id });
  return nova!.id;
}

/** Hoje, no fuso do processo (é uma casa só, num fuso só). */
export function hojeDoServidor(): Ymd {
  return ymdLocal(new Date());
}

export const diaDoMes = (d: Ymd) => partes(d).d;
export const mesDoDia = mesDe;
