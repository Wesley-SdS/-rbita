import { eq, getTableColumns, inArray, is, type SQL } from "drizzle-orm";
import { PgTable, getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { db } from "@orbita/db";
import * as schema from "@orbita/db/schema";
import { events } from "../events/index";

/**
 * DADOS DA CONTA: apagar e exportar (LGPD), derivados do SCHEMA, não de uma
 * lista escrita à mão (RV.6).
 *
 * A lista à mão já tinha envelhecido: o export parou nas tabelas da Onda 1 e o
 * `event_log` (payloads com dado pessoal) ficava para trás ao apagar a conta,
 * porque não tem FK. Na Fase 2 entram amostras e vetores biométricos, e "apagar
 * é apagar tudo" não pode depender de alguém lembrar de atualizar uma lista.
 *
 * Regra: pertence ao usuário toda tabela com `user_id`, e toda tabela sem
 * `user_id` que referencia uma dessas por FK (ex.: `message` → `conversation`).
 * O teste `data.test.ts` garante que cada uma é apagada (FK com cascade ou
 * limpeza explícita aqui) e exportada.
 */

export interface OwnedTable {
  name: string;
  table: PgTable;
  /** coluna que liga ao dono: `user_id` direto, ou a FK para uma tabela já do usuário */
  column: PgColumn;
  /** tabela do usuário referenciada (filha, neta...) e a coluna alvo da FK */
  via?: { owner: OwnedTable; foreignColumn: PgColumn };
  /** o que a FK faz quando o pai some */
  onDelete: string | undefined;
}

/**
 * Tabelas em que `set null` é INTENCIONAL: a linha fica, só perde o dono.
 * `instance_owner` precisa sobreviver órfã, senão a posse seria reivindicada de
 * novo pelo usuário mais antigo (RV.1). Qualquer outra tabela com `set null`
 * para o usuário deixaria dado pessoal para trás: o teste reprova.
 */
export const ORPHAN_BY_DESIGN = new Set(["instance_owner"]);

// Credencial nunca sai no export, mesmo cifrada. Por nome de coluna, para valer
// em tabela nova sem ninguém lembrar.
// Termina no nome do segredo: `access_token` sai, `access_token_expires_at` (só uma data) fica.
const SEGREDO = /(^|_)(token|password|secret|headers|p256dh|auth)$|_enc$/;

/** Colunas que ficam fora do export e por quê. Puro. */
export function omittedReason(tableName: string, columnName: string): string | null {
  if (SEGREDO.test(columnName)) return "credencial (não sai da Órbita, nem cifrada)";
  // assinatura biométrica NUNCA sai desta casa (PRD §4.1), e "exportar meus
  // dados" é uma saída como qualquer outra. Por prefixo de tabela para valer em
  // tabela biométrica nova sem ninguém lembrar.
  if (tableName.startsWith("biometric_")) {
    if (columnName === "vector") return "assinatura biométrica (nunca sai desta casa, nem no export)";
    // `backend` é o `model` das tabelas de ROSTO: o vetor não se compara sem
    // saber quem o gerou, então exportar um sem o outro seria meia assinatura
    if (columnName === "model" || columnName === "backend" || columnName === "dim") return "detalhe da assinatura biométrica (nunca sai desta casa)";
  }
  if (columnName === "embedding") return "vetor derivado do texto já exportado (recalculável)";
  if (tableName === "camera_event" && columnName === "snapshot") return "imagem pesada; continua visível na tela de câmeras até a retenção";
  return null;
}

function tables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
}

/**
 * Todas as tabelas com dado do usuário, derivadas do schema: diretas (com
 * `user_id`) e, em cadeia, quem referencia uma delas por FK (filhas, netas...).
 */
export function userOwnedTables(): OwnedTable[] {
  const out: OwnedTable[] = [];
  const porTabela = new Map<PgTable, OwnedTable>();

  for (const t of tables()) {
    const cfg = getTableConfig(t);
    const col = cfg.columns.find((c) => c.name === "user_id");
    if (!col) continue;
    const fk = cfg.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "user_id"));
    const owned: OwnedTable = { name: cfg.name, table: t, column: col, onDelete: fk?.onDelete };
    porTabela.set(t, owned);
    out.push(owned);
  }

  // ponto fixo: cada volta pode descobrir uma geração a mais (neta de neta...)
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const t of tables()) {
      if (porTabela.has(t)) continue;
      const cfg = getTableConfig(t);
      if (cfg.name === "user") continue; // a própria conta vai à parte
      for (const fk of cfg.foreignKeys) {
        const ref = fk.reference();
        const pai = porTabela.get(ref.foreignTable as PgTable);
        if (!pai) continue;
        const owned: OwnedTable = { name: cfg.name, table: t, column: ref.columns[0], via: { owner: pai, foreignColumn: ref.foreignColumns[0] }, onDelete: fk.onDelete };
        porTabela.set(t, owned);
        out.push(owned);
        mudou = true;
        break;
      }
    }
  }
  return out;
}

/** Some quando o usuário é apagado, sem ação explícita? */
export function erasedByCascade(t: OwnedTable): boolean {
  if (t.onDelete === "cascade") return !t.via || erasedByCascade(t.via.owner);
  return false;
}

function ownedWhere(t: OwnedTable, userId: string): SQL {
  if (!t.via) return eq(t.column, userId);
  const pai = t.via.owner;
  return inArray(t.column, db.select({ id: t.via.foreignColumn }).from(pai.table).where(ownedWhere(pai, userId)));
}

/**
 * Apaga a conta e TUDO dela numa transação. Tabelas com FK em cascade somem
 * junto com o `user`; as sem cascade (hoje, o `event_log`) são limpas antes,
 * explicitamente.
 */
export async function eraseAccount(userId: string): Promise<{ limpezaExplicita: string[] }> {
  const semCascade = userOwnedTables().filter((t) => !erasedByCascade(t) && !ORPHAN_BY_DESIGN.has(t.name));
  await db.transaction(async (tx) => {
    // filhas antes dos pais: a subconsulta da filha precisa do pai ainda lá
    for (const t of [...semCascade].reverse()) await tx.delete(t.table).where(ownedWhere(t, userId));
    await tx.delete(schema.user).where(eq(schema.user.id, userId));
  });
  // a linha do usuário já foi embora: o evento fica SEM dono, e sem nada que
  // identifique quem era (é o resto de trilha que "apagar é apagar" permite)
  await events.emit("account.erased", { tabelas: semCascade.map((t) => t.name) }, { userId: null }).catch(() => undefined);
  return { limpezaExplicita: semCascade.map((t) => t.name) };
}

export interface AccountExport {
  exportadoEm: string;
  usuario: { id: string; nome: string; email: string };
  tabelas: Record<string, Record<string, unknown>[]>;
  /** "tabela.coluna" → por que não veio */
  omitidos: Record<string, string>;
}

/** Exporta tudo que é do usuário, sem credenciais nem vetores. */
export async function exportAccount(u: { id: string; name: string; email: string }): Promise<AccountExport> {
  const tabelas: AccountExport["tabelas"] = {};
  const omitidos: AccountExport["omitidos"] = {};

  await Promise.all(
    userOwnedTables().map(async (t) => {
      const selecao: Record<string, PgColumn> = {};
      for (const [chave, col] of Object.entries(getTableColumns(t.table)) as [string, PgColumn][]) {
        const motivo = omittedReason(t.name, col.name);
        if (motivo) omitidos[`${t.name}.${col.name}`] = motivo;
        else selecao[chave] = col;
      }
      tabelas[t.name] = (await db.select(selecao).from(t.table).where(ownedWhere(t, u.id))) as Record<string, unknown>[];
    }),
  );

  // exportar é uma saída de dados: fica na trilha, como toda saída
  await events.emit("account.exported", { tabelas: Object.keys(tabelas).length, omitidos: Object.keys(omitidos).length }, { userId: u.id }).catch(() => undefined);
  return { exportadoEm: new Date().toISOString(), usuario: { id: u.id, nome: u.name, email: u.email }, tabelas, omitidos };
}
