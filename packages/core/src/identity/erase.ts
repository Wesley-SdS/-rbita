import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { PgTable, getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { db } from "@orbita/db";
import * as schema from "@orbita/db/schema";
import { eventLog } from "@orbita/db/event-schema";
import { person } from "@orbita/db/home-schema";
import { biometricConsent, identityAudit } from "@orbita/db/identity-schema";
import { IdentityError } from "./errors";
import { forgetVoiceTraces } from "./voice";

/**
 * APAGAR É APAGAR (PRD §4.5), derivado do schema para não depender de memória:
 *   - toda tabela `biometric_*` com `person_id` (amostras, vetores de voz e de
 *     rosto das Ondas 9 e 10): as linhas da pessoa somem
 *   - toda coluna `identified_person_id` (ex.: `camera_event` na Onda 10): a
 *     referência vira null, junto com as colunas `identified_*` da mesma linha
 *   - `event_log`: evento cujo payload menciona a pessoa some
 *   - `identity_audit`: o que identifica a pessoa some; fica só um registro
 *     anônimo de que houve apagamento
 *   - consentimentos ativos são revogados (cadastrar de novo exige novo aceite)
 */

const tables = () => (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));

export interface BiometricTable {
  name: string;
  table: PgTable;
  personColumn: PgColumn;
}

/** Tabelas de biometria propriamente dita (não o consentimento, que é registro). */
export function biometricTables(): BiometricTable[] {
  const out: BiometricTable[] = [];
  for (const t of tables()) {
    const cfg = getTableConfig(t);
    if (!cfg.name.startsWith("biometric_") || cfg.name === "biometric_consent") continue;
    const col = cfg.columns.find((c) => c.name === "person_id");
    if (col) out.push({ name: cfg.name, table: t, personColumn: col });
  }
  return out;
}

export interface IdentifiedRef {
  name: string;
  table: PgTable;
  personColumn: PgColumn;
  /** todas as colunas `identified_*` da tabela (nome, confiança...), zeradas junto */
  columns: Record<string, PgColumn>;
}

/** Referências de identificação espalhadas em tabelas de percepção (câmera etc.). */
export function identifiedRefs(): IdentifiedRef[] {
  const out: IdentifiedRef[] = [];
  for (const t of tables()) {
    const cfg = getTableConfig(t);
    const personColumn = cfg.columns.find((c) => c.name === "identified_person_id");
    if (!personColumn) continue;
    const columns: Record<string, PgColumn> = {};
    for (const [key, col] of Object.entries(getTableColumns(t)) as [string, PgColumn][]) {
      if (col.name.startsWith("identified_") && !col.notNull) columns[key] = col;
    }
    out.push({ name: cfg.name, table: t, personColumn, columns });
  }
  return out;
}

export interface EraseResult {
  tabelas: string[];
  referencias: string[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Apaga dentro de uma transação já aberta. Filtra `event_log` pelo uuid no
 * payload SEM restringir a conta: numa instância de um dono só, um evento de
 * sistema (sem dono) ou emitido pela conta de login da própria pessoa também é
 * resíduo dela.
 */
async function eraseWithin(tx: Tx, ownerUserId: string, personId: string, bio: BiometricTable[], refs: IdentifiedRef[]): Promise<void> {
  for (const b of bio) await tx.delete(b.table).where(eq(b.personColumn, personId));
  for (const r of refs) {
    const nulos = Object.fromEntries(Object.keys(r.columns).map((k) => [k, null]));
    if (Object.keys(nulos).length) await tx.update(r.table).set(nulos).where(eq(r.personColumn, personId));
  }
  // o id é uuid: aparecer no texto do payload é mencionar a pessoa, sem falso positivo
  await tx.delete(eventLog).where(sql`${eventLog.payload}::text like ${"%" + personId + "%"}`);
  await tx.delete(identityAudit).where(and(eq(identityAudit.userId, ownerUserId), eq(identityAudit.personId, personId)));
  // como ATOR (ex.: consulta feita por ela, reconhecida pela voz) o vínculo também some
  await tx.update(identityAudit).set({ actorPersonId: null }).where(eq(identityAudit.actorPersonId, personId));
  await tx.update(biometricConsent).set({ revokedAt: new Date() }).where(and(eq(biometricConsent.personId, personId), isNull(biometricConsent.revokedAt)));
  // registro anônimo: houve apagamento, sem dizer de quem
  await tx.insert(identityAudit).values({ userId: ownerUserId, action: "apagamento", outcome: "apagado", detail: { tabelas: bio.map((b) => b.name) } });
}

async function assertPerson(ownerUserId: string, personId: string): Promise<void> {
  const [p] = await db.select({ id: person.id }).from(person).where(and(eq(person.id, personId), eq(person.userId, ownerUserId))).limit(1);
  if (!p) throw new IdentityError("Pessoa não encontrada", 404);
}

/** Apaga TODA biometria de uma pessoa (voz e rosto), numa transação. Mantém o cadastro. */
export async function eraseBiometrics(ownerUserId: string, personId: string): Promise<EraseResult> {
  await assertPerson(ownerUserId, personId);
  // antes do apagar: precisa das assinaturas dela para achar os desconhecidos que são ela
  await forgetVoiceTraces(ownerUserId, personId);
  const bio = biometricTables();
  const refs = identifiedRefs();
  await db.transaction((tx) => eraseWithin(tx, ownerUserId, personId, bio, refs));
  return { tabelas: bio.map((b) => b.name), referencias: refs.map((r) => r.name) };
}

/** Remove a pessoa por inteiro na MESMA transação: ou some tudo, ou nada. */
export async function removePerson(ownerUserId: string, personId: string): Promise<EraseResult> {
  await assertPerson(ownerUserId, personId);
  await forgetVoiceTraces(ownerUserId, personId);
  const bio = biometricTables();
  const refs = identifiedRefs();
  await db.transaction(async (tx) => {
    await eraseWithin(tx, ownerUserId, personId, bio, refs);
    await tx.delete(person).where(and(eq(person.id, personId), eq(person.userId, ownerUserId)));
  });
  return { tabelas: bio.map((b) => b.name), referencias: refs.map((r) => r.name) };
}
