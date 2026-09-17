import { eq, inArray } from "drizzle-orm";
import { db } from "@orbita/db";
import { person } from "@orbita/db/home-schema";
import { personVisibility, identityAudit } from "@orbita/db/identity-schema";
import { settings } from "../settings";
import type { Requester } from "../tools/registry";
import { canAskAbout, type PersonLike } from "./rules";

/**
 * "Perguntar sobre outra pessoa exige permissão" (PRD §4.7) aplicado nas tools.
 * A regra pura mora em rules.ts; aqui só se buscam os dados e se registra a
 * consulta na trilha, inclusive quando é negada.
 */

type PersonRow = typeof person.$inferSelect;
const asLike = (p: PersonRow): PersonLike => ({ id: p.id, role: p.role, relation: p.relation, isMinor: p.isMinor, guardianPersonId: p.guardianPersonId });

export interface AskContext {
  viewer: PersonLike | null;
  policy: "negado" | "moradores_entre_si";
  grants: { viewerPersonId: string; subjectPersonId: string; allowed: boolean }[];
  people: PersonRow[];
}

/**
 * Contexto de uma consulta sobre pessoas. `requester` nulo (chat da conta dona
 * sem pessoa vinculada) vale como dono: é a mesma conta que administra a casa.
 */
export async function askContext(ownerUserId: string, requester: Requester | null): Promise<AskContext> {
  const [people, policy] = await Promise.all([
    db.select().from(person).where(eq(person.userId, ownerUserId)),
    settings.get("identity.askAboutOthersDefault"),
  ]);
  const grants = people.length
    ? await db.select({ viewerPersonId: personVisibility.viewerPersonId, subjectPersonId: personVisibility.subjectPersonId, allowed: personVisibility.allowed }).from(personVisibility).where(inArray(personVisibility.viewerPersonId, people.map((p) => p.id)))
    : [];

  let viewer: PersonLike | null = { id: "__dono__", role: "dono", relation: "morador", isMinor: false, guardianPersonId: null };
  if (requester) {
    const p = requester.personId ? people.find((x) => x.id === requester.personId) : null;
    viewer = p ? asLike(p) : { id: "__anonimo__", role: requester.role, relation: "morador", isMinor: false, guardianPersonId: null };
  }
  return { viewer, policy, grants, people };
}

/** Pode saber sobre esta pessoa? Registra a consulta (permitida ou negada) na trilha. */
export async function canAskAndAudit(ownerUserId: string, ctx: AskContext, subject: PersonRow, motivo: string): Promise<boolean> {
  const ok = canAskAbout(ctx.viewer, asLike(subject), ctx.grants, ctx.policy);
  await db.insert(identityAudit).values({
    userId: ownerUserId,
    action: ok ? "consulta" : "consulta_negada",
    personId: subject.id,
    actorPersonId: ctx.viewer && ctx.viewer.id.startsWith("__") ? null : (ctx.viewer?.id ?? null),
    source: "chat",
    outcome: ok ? "permitido" : "negado",
    detail: { motivo },
  });
  return ok;
}

/**
 * Filtra a lista pelo que quem pergunta pode saber. Audita UMA linha por
 * consulta (com quem entrou e quem foi negado), não uma por pessoa: numa casa
 * com 8 pessoas, o laço antigo eram 8 INSERTs dentro do turno e uma trilha
 * cheia de "permitido" do próprio dono.
 */
export async function visiblePeople(ownerUserId: string, ctx: AskContext, motivo: string): Promise<PersonRow[]> {
  const permitidas = ctx.people.filter((p) => canAskAbout(ctx.viewer, asLike(p), ctx.grants, ctx.policy));
  const negadas = ctx.people.filter((p) => !permitidas.includes(p));
  const anonimo = !ctx.viewer || ctx.viewer.id.startsWith("__");
  await db.insert(identityAudit).values({
    userId: ownerUserId,
    action: negadas.length ? "consulta_negada" : "consulta",
    actorPersonId: anonimo ? null : ctx.viewer!.id,
    source: "chat",
    outcome: negadas.length ? "parcial" : "permitido",
    detail: { motivo, permitidas: permitidas.map((p) => p.id), negadas: negadas.map((p) => p.id) },
  });
  return permitidas;
}

/** Acha a pessoa pelo nome ou apelido (o modelo fala "a Anna", "a mãe"). Puro. */
export function findPersonByName(people: readonly PersonRow[], nome: string): PersonRow | null {
  const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const alvo = normal(nome);
  if (!alvo) return null;
  return (
    people.find((p) => normal(p.name) === alvo) ??
    people.find((p) => p.aliases.some((a) => normal(a) === alvo)) ??
    people.find((p) => normal(p.name).startsWith(alvo) || alvo.startsWith(normal(p.name))) ??
    null
  );
}
