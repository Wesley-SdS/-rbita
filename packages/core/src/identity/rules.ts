import { createHash } from "node:crypto";

/**
 * REGRAS PURAS de identidade (Fase 2). Sem banco: quem consulta busca os dados
 * e chama isto, e o teste cobre cada caso sem subir nada.
 */

export type BiometricKind = "voz" | "rosto";
export const BIOMETRIC_KINDS: readonly BiometricKind[] = ["voz", "rosto"];

export type HouseRole = "dono" | "morador" | "visitante";
export type Relation = "morador" | "visitante_frequente" | "contato_externo";

export interface PersonLike {
  id: string;
  role: HouseRole;
  relation: Relation;
  isMinor: boolean;
  guardianPersonId: string | null;
}

export interface ConsentLike {
  personId: string;
  kinds: string[];
  grantedBy: "propria_pessoa" | "responsavel";
  guardianPersonId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
}

/** Versão curta e estável do termo: muda quando o texto muda, então o registro diz exatamente o que foi aceito. */
export function termVersion(termText: string): string {
  return createHash("sha256").update(termText.trim()).digest("hex").slice(0, 12);
}

export type ConsentCheck = { ok: true; consent: ConsentLike } | { ok: false; motivo: string };

/**
 * Existe consentimento VÁLIDO desta pessoa para este tipo de biometria?
 * Menor só conta se quem consentiu foi o responsável (PRD §4.4). O mais recente
 * não revogado vence.
 */
export function consentFor(p: PersonLike, consents: readonly ConsentLike[], kind: BiometricKind): ConsentCheck {
  const validos = consents
    .filter((c) => c.personId === p.id && !c.revokedAt && c.kinds.includes(kind))
    // menor: só vale o consentimento do responsável ATUAL. Trocar ou remover o
    // responsável derruba o que o anterior consentiu (PRD §4.4).
    .filter((c) => !p.isMinor || (c.grantedBy === "responsavel" && !!c.guardianPersonId && c.guardianPersonId === p.guardianPersonId))
    .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
  if (validos[0]) return { ok: true, consent: validos[0] };
  if (p.isMinor && consents.some((c) => c.personId === p.id && !c.revokedAt && c.kinds.includes(kind))) {
    return { ok: false, motivo: "Menor de idade: o consentimento precisa ser dado pelo responsável cadastrado atual." };
  }
  return { ok: false, motivo: `Sem consentimento registrado para ${kind}.` };
}

export interface ConsentInput {
  kinds: BiometricKind[];
  grantedBy: "propria_pessoa" | "responsavel";
  guardianPersonId: string | null;
}

/**
 * Valida o registro de um consentimento ANTES de gravar. `guardian` é o cadastro
 * de quem consente como responsável, quando há. Devolve a mensagem de erro em
 * pt-BR ou null.
 */
export function validateConsentInput(p: PersonLike, input: ConsentInput, guardian: PersonLike | null): string | null {
  if (!input.kinds.length) return "Escolha ao menos um tipo de biometria (voz ou rosto).";
  if (p.isMinor) {
    if (input.grantedBy !== "responsavel") return "Menor de idade: quem consente é o responsável.";
    // sem responsável cadastrado, qualquer adulto (até um contato externo) poderia consentir
    if (!p.guardianPersonId) return "Cadastre o responsável desta pessoa antes de registrar o consentimento.";
    if (!input.guardianPersonId || !guardian) return "Indique o responsável cadastrado que está consentindo.";
    if (guardian.isMinor) return "O responsável não pode ser menor de idade.";
    if (p.guardianPersonId !== guardian.id) return "Só o responsável cadastrado desta pessoa pode consentir por ela.";
    return null;
  }
  // adulto consente por si: "a Anna aceita por ela" (PRD §4.4)
  if (input.grantedBy !== "propria_pessoa") return "Pessoa adulta consente por ela mesma.";
  if (input.guardianPersonId) return "Pessoa adulta não tem responsável no consentimento.";
  return null;
}

export type AskPolicy = "negado" | "moradores_entre_si";

export interface VisibilityGrant {
  viewerPersonId: string;
  subjectPersonId: string;
  allowed: boolean;
}

/**
 * Quem PERGUNTA pode saber sobre quem ("onde está a Anna?")? PRD §4.7.
 *   - dono da casa: sim
 *   - sobre si mesmo: sim
 *   - responsável sobre o menor dele: sim
 *   - regra explícita (tela): vence o padrão, nos dois sentidos
 *   - senão, a política padrão (`identity.askAboutOthersDefault`)
 * `viewer` null = não se sabe quem pergunta: nega, exceto se for sobre ninguém.
 */
export function canAskAbout(viewer: PersonLike | null, subject: PersonLike, grants: readonly VisibilityGrant[], policy: AskPolicy): boolean {
  if (!viewer) return false;
  if (viewer.role === "dono") return true;
  if (viewer.id === subject.id) return true;
  if (subject.isMinor && subject.guardianPersonId === viewer.id) return true;
  const explicit = grants.find((g) => g.viewerPersonId === viewer.id && g.subjectPersonId === subject.id);
  if (explicit) return explicit.allowed;
  if (policy === "moradores_entre_si") return viewer.relation === "morador" && subject.relation === "morador" && !subject.isMinor;
  return false;
}

/**
 * Mudança de cadastro que invalida consentimento já dado: virar menor, ou menor
 * trocar de responsável. Nesses casos os consentimentos vigentes são revogados
 * (quem consentiu antes não é mais quem pode consentir). Puro.
 */
export function consentInvalidatedBy(before: Pick<PersonLike, "isMinor" | "guardianPersonId">, after: Pick<PersonLike, "isMinor" | "guardianPersonId">): boolean {
  if (!before.isMinor && after.isMinor) return true;
  if (before.isMinor && after.isMinor && before.guardianPersonId !== after.guardianPersonId) return true;
  return false;
}

/** Validação de cadastro: responsável coerente. Devolve erro em pt-BR ou null. */
export function validateGuardian(p: { id?: string; isMinor: boolean }, guardian: PersonLike | null, guardianId: string | null): string | null {
  if (!guardianId) return null;
  if (!guardian) return "Responsável não encontrado.";
  if (p.id && guardian.id === p.id) return "A pessoa não pode ser responsável por ela mesma.";
  if (guardian.isMinor) return "O responsável não pode ser menor de idade.";
  return null;
}
