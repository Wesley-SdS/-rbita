import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@orbita/db";
import { user } from "@orbita/db/auth-schema";
import { person, personRoomAccess, room } from "@orbita/db/home-schema";
import { biometricConsent, identityAudit, personVisibility } from "@orbita/db/identity-schema";
import { settings } from "../settings";
import { events } from "../events/index";
import { BIOMETRIC_KINDS, consentFor, consentInvalidatedBy, termVersion, validateConsentInput, validateGuardian, type BiometricKind, type PersonLike } from "./rules";
import { IdentityError } from "./errors";
import { forgetVoiceTraces } from "./voice";
import { forgetFaceTraces } from "./face";

export { IdentityError };

/**
 * Pessoas da casa, consentimento e auditoria (Onda 8). NÃO é multi-tenant
 * (CLAUDE.md §1): toda pessoa pertence à conta do dono (`userId`); a conta de
 * login de alguém da casa, quando existe, fica em `accountUserId`.
 */

// Campos SEM default: o PATCH parcial não pode preencher o que não veio (em zod 4,
// `.partial()` mantém os defaults internos e sobrescreveria o cadastro).
const PersonFields = {
  name: z.string().trim().min(1).max(80),
  role: z.enum(["dono", "morador", "visitante"]),
  aliases: z.array(z.string().trim().min(1).max(40)).max(20),
  relation: z.enum(["morador", "visitante_frequente", "contato_externo"]),
  isMinor: z.boolean(),
  guardianPersonId: z.string().uuid().nullable(),
  /** e-mail da conta de login desta pessoa, se ela tiver uma; vazio desvincula */
  accountEmail: z.string().trim().max(254).nullable(),
};

export const PersonInputSchema = z.object({
  name: PersonFields.name,
  role: PersonFields.role.default("morador"),
  aliases: PersonFields.aliases.default([]),
  relation: PersonFields.relation.default("morador"),
  isMinor: PersonFields.isMinor.default(false),
  guardianPersonId: PersonFields.guardianPersonId.default(null),
  accountEmail: PersonFields.accountEmail.default(null),
});
export type PersonInput = z.infer<typeof PersonInputSchema>;
export const PersonPatchSchema = z.object(PersonFields).partial();

type PersonRow = typeof person.$inferSelect;

const asLike = (p: PersonRow): PersonLike => ({ id: p.id, role: p.role, relation: p.relation, isMinor: p.isMinor, guardianPersonId: p.guardianPersonId });

export async function getPerson(ownerUserId: string, personId: string): Promise<PersonRow | null> {
  const [p] = await db.select().from(person).where(and(eq(person.id, personId), eq(person.userId, ownerUserId))).limit(1);
  return p ?? null;
}

async function resolveAccount(ownerUserId: string, email: string | null | undefined, selfId?: string): Promise<string | null | undefined> {
  if (email === undefined) return undefined;
  if (!email) return null;
  const [u] = await db.select({ id: user.id }).from(user).where(eq(sql`lower(${user.email})`, email.toLowerCase())).limit(1);
  if (!u) throw new IdentityError("Não existe conta com esse e-mail na Órbita.", 404);
  // uma conta = uma pessoa: senão "quem pede" mudaria de identidade entre requests
  const [outra] = await db
    .select({ name: person.name })
    .from(person)
    .where(and(eq(person.userId, ownerUserId), eq(person.accountUserId, u.id), selfId ? ne(person.id, selfId) : undefined))
    .limit(1);
  if (outra) throw new IdentityError(`Essa conta já está vinculada a ${outra.name}.`, 409);
  return u.id;
}

async function checkGuardian(ownerUserId: string, self: { id?: string; isMinor: boolean }, guardianId: string | null | undefined) {
  if (!guardianId) return;
  const g = await getPerson(ownerUserId, guardianId);
  const erro = validateGuardian(self, g ? asLike(g) : null, guardianId);
  if (erro) throw new IdentityError(erro);
}

export async function createPerson(ownerUserId: string, input: PersonInput): Promise<{ id: string }> {
  await checkGuardian(ownerUserId, { isMinor: input.isMinor }, input.guardianPersonId);
  const accountUserId = await resolveAccount(ownerUserId, input.accountEmail);
  const [row] = await db
    .insert(person)
    .values({
      userId: ownerUserId,
      name: input.name,
      role: input.role,
      aliases: input.aliases,
      relation: input.relation,
      isMinor: input.isMinor,
      guardianPersonId: input.guardianPersonId,
      accountUserId: accountUserId ?? null,
    })
    .returning({ id: person.id });
  await audit({ userId: ownerUserId, action: "cadastro", personId: row!.id, source: "tela", outcome: "criado" });
  return { id: row!.id };
}

export async function updatePerson(ownerUserId: string, personId: string, patch: z.infer<typeof PersonPatchSchema>): Promise<void> {
  const atual = await getPerson(ownerUserId, personId);
  if (!atual) throw new IdentityError("Pessoa não encontrada", 404);
  // valida o ESTADO RESULTANTE, não só os campos enviados: mudar só `isMinor`
  // também precisa conferir o responsável que já estava lá
  const depois = {
    isMinor: patch.isMinor ?? atual.isMinor,
    guardianPersonId: patch.guardianPersonId !== undefined ? patch.guardianPersonId : atual.guardianPersonId,
  };
  await checkGuardian(ownerUserId, { id: personId, isMinor: depois.isMinor }, depois.guardianPersonId);
  if (depois.isMinor && !atual.isMinor) {
    const [dependente] = await db
      .select({ name: person.name })
      .from(person)
      .where(and(eq(person.userId, ownerUserId), eq(person.guardianPersonId, personId)))
      .limit(1);
    if (dependente) throw new IdentityError(`Não dá para marcar como menor: é responsável por ${dependente.name}.`);
  }
  const accountUserId = await resolveAccount(ownerUserId, patch.accountEmail, personId);
  const { accountEmail: _email, ...campos } = patch;
  const revogar = consentInvalidatedBy(atual, depois);

  await db.transaction(async (tx) => {
    await tx
      .update(person)
      .set({ ...campos, ...(accountUserId !== undefined ? { accountUserId } : {}), updatedAt: new Date() })
      .where(and(eq(person.id, personId), eq(person.userId, ownerUserId)));
    if (!revogar) return;
    // quem consentiu antes não é mais quem pode consentir (virou menor ou trocou o responsável)
    const revogados = await tx
      .update(biometricConsent)
      .set({ revokedAt: new Date() })
      .where(and(eq(biometricConsent.personId, personId), isNull(biometricConsent.revokedAt)))
      .returning({ id: biometricConsent.id });
    if (revogados.length) {
      await tx.insert(identityAudit).values({
        userId: ownerUserId,
        action: "revogacao",
        personId,
        source: "tela",
        outcome: "revogado",
        detail: { motivo: "responsável ou menoridade mudou", consentimentos: revogados.length },
      });
    }
  });
}

/** Pessoa da casa que corresponde a uma conta de login (quem pede, no chat); null se não houver. */
export async function personForAccount(ownerUserId: string, accountUserId: string): Promise<PersonRow | null> {
  const [p] = await db.select().from(person).where(and(eq(person.userId, ownerUserId), eq(person.accountUserId, accountUserId))).limit(1);
  return p ?? null;
}

/** Lista para a tela: pessoa, acessos, consentimento vigente por tipo, permissões. */
export async function listPeople(ownerUserId: string) {
  const people = await db.select().from(person).where(eq(person.userId, ownerUserId)).orderBy(person.createdAt);
  const ids = people.map((p) => p.id);
  const contaIds = people.map((p) => p.accountUserId).filter((x): x is string => !!x);
  const [access, consents, grants, contas] = await Promise.all([
    ids.length
      ? db
          .select({ personId: personRoomAccess.personId, roomId: personRoomAccess.roomId, allowed: personRoomAccess.allowed, roomName: room.name })
          .from(personRoomAccess)
          .innerJoin(room, eq(room.id, personRoomAccess.roomId))
          .where(inArray(personRoomAccess.personId, ids))
      : [],
    ids.length ? db.select().from(biometricConsent).where(inArray(biometricConsent.personId, ids)).orderBy(desc(biometricConsent.grantedAt)) : [],
    ids.length ? db.select().from(personVisibility).where(inArray(personVisibility.viewerPersonId, ids)) : [],
    contaIds.length ? db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, contaIds)) : [],
  ]);
  const emailDe = new Map(contas.map((c) => [c.id, c.email]));

  return people.map((p) => {
    const like = asLike(p);
    const deles = consents.filter((c) => c.personId === p.id);
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      aliases: p.aliases,
      relation: p.relation,
      isMinor: p.isMinor,
      guardianPersonId: p.guardianPersonId,
      accountEmail: p.accountUserId ? (emailDe.get(p.accountUserId) ?? null) : null,
      access: access.filter((a) => a.personId === p.id),
      consentimento: Object.fromEntries(BIOMETRIC_KINDS.map((k) => [k, consentFor(like, deles, k).ok])) as Record<BiometricKind, boolean>,
      consentimentos: deles.map((c) => ({ id: c.id, kinds: c.kinds, grantedBy: c.grantedBy, guardianName: c.guardianName, termVersion: c.termVersion, grantedAt: c.grantedAt, revokedAt: c.revokedAt })),
      podeVer: grants.filter((g) => g.viewerPersonId === p.id).map((g) => ({ subjectPersonId: g.subjectPersonId, allowed: g.allowed })),
    };
  });
}

// ── termo e consentimento ───────────────────────────────────────────────────

export async function currentTerm(): Promise<{ text: string; version: string }> {
  const text = await settings.get("identity.consentTerm");
  return { text, version: termVersion(text) };
}

export const ConsentInputSchema = z.object({
  personId: z.string().uuid(),
  kinds: z.array(z.enum(["voz", "rosto"])).min(1).max(2),
  grantedBy: z.enum(["propria_pessoa", "responsavel"]),
  guardianPersonId: z.string().uuid().nullable().default(null),
  /** a versão que a tela MOSTROU: se o termo mudou no meio, o aceite não vale */
  termVersion: z.string().min(6).max(64),
});

export async function recordConsent(ownerUserId: string, recordedByUserId: string, input: z.infer<typeof ConsentInputSchema>): Promise<{ id: string }> {
  const p = await getPerson(ownerUserId, input.personId);
  if (!p) throw new IdentityError("Pessoa não encontrada", 404);
  const guardian = input.guardianPersonId ? await getPerson(ownerUserId, input.guardianPersonId) : null;
  const erro = validateConsentInput(asLike(p), { kinds: [...new Set(input.kinds)], grantedBy: input.grantedBy, guardianPersonId: input.guardianPersonId }, guardian ? asLike(guardian) : null);
  if (erro) throw new IdentityError(erro);
  const termo = await currentTerm();
  if (termo.version !== input.termVersion) throw new IdentityError("O termo de consentimento mudou. Leia a versão atual antes de aceitar.");

  if (!termo.text.trim()) throw new IdentityError("O termo de consentimento está vazio. Escreva o termo em Ajustes antes de registrar.");

  // consentimento sem trilha não pode existir (PRD §4.7): gravação e auditoria juntas
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(biometricConsent)
      .values({
        userId: ownerUserId,
        personId: p.id,
        kinds: [...new Set(input.kinds)],
        grantedBy: input.grantedBy,
        guardianPersonId: guardian?.id ?? null,
        guardianName: guardian?.name ?? null,
        termVersion: termo.version,
        termText: termo.text,
        recordedByUserId,
      })
      .returning({ id: biometricConsent.id });
    await tx.insert(identityAudit).values({
      userId: ownerUserId,
      action: "consentimento",
      personId: p.id,
      actorPersonId: guardian?.id ?? null,
      source: "tela",
      outcome: "concedido",
      detail: { tipos: input.kinds, termo: termo.version },
    });
    return r;
  });
  await events.emit("identity.consent_granted", { personId: p.id, tipos: input.kinds }, { userId: ownerUserId });
  return { id: row!.id };
}

export async function revokeConsent(ownerUserId: string, consentId: string): Promise<void> {
  const [c] = await db
    .update(biometricConsent)
    .set({ revokedAt: new Date() })
    .where(and(eq(biometricConsent.id, consentId), eq(biometricConsent.userId, ownerUserId), sql`${biometricConsent.revokedAt} is null`))
    .returning({ personId: biometricConsent.personId, kinds: biometricConsent.kinds });
  if (!c) throw new IdentityError("Consentimento não encontrado ou já revogado", 404);
  // revogou voz: a voz dela deixa de ser reconhecível também como "desconhecido"
  if (c.kinds.includes("voz")) await forgetVoiceTraces(ownerUserId, c.personId);
  if (c.kinds.includes("rosto")) await forgetFaceTraces(ownerUserId, c.personId);
  await audit({ userId: ownerUserId, action: "revogacao", personId: c.personId, source: "tela", outcome: "revogado", detail: { tipos: c.kinds } });
  await events.emit("identity.consent_revoked", { personId: c.personId, tipos: c.kinds }, { userId: ownerUserId });
}

// ── permissão sobre pessoas ─────────────────────────────────────────────────

export const VisibilityInputSchema = z.object({
  viewerPersonId: z.string().uuid(),
  subjectPersonId: z.string().uuid(),
  allowed: z.boolean().nullable(),
});

export async function setVisibility(ownerUserId: string, input: z.infer<typeof VisibilityInputSchema>): Promise<void> {
  if (input.viewerPersonId === input.subjectPersonId) throw new IdentityError("Toda pessoa já pode perguntar sobre si mesma.");
  const [v, s] = await Promise.all([getPerson(ownerUserId, input.viewerPersonId), getPerson(ownerUserId, input.subjectPersonId)]);
  if (!v || !s) throw new IdentityError("Pessoa não encontrada", 404);
  const par = and(eq(personVisibility.viewerPersonId, v.id), eq(personVisibility.subjectPersonId, s.id));
  if (input.allowed === null) await db.delete(personVisibility).where(par);
  else
    await db
      .insert(personVisibility)
      .values({ viewerPersonId: v.id, subjectPersonId: s.id, allowed: input.allowed })
      .onConflictDoUpdate({ target: [personVisibility.viewerPersonId, personVisibility.subjectPersonId], set: { allowed: input.allowed, updatedAt: new Date() } });
}

// ── auditoria ───────────────────────────────────────────────────────────────

export type AuditEntry = typeof identityAudit.$inferInsert;

/** Toda identificação, consulta e mudança de consentimento passa por aqui (PRD §4.7). */
export async function audit(entry: AuditEntry): Promise<void> {
  await db.insert(identityAudit).values(entry);
}

export async function listAudit(ownerUserId: string, opts: { personId?: string; limit: number }) {
  const where = opts.personId ? and(eq(identityAudit.userId, ownerUserId), eq(identityAudit.personId, opts.personId)) : eq(identityAudit.userId, ownerUserId);
  return db.select().from(identityAudit).where(where).orderBy(desc(identityAudit.createdAt)).limit(opts.limit);
}
