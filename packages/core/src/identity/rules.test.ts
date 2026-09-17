import { describe, expect, it } from "vitest";
import { canAskAbout, consentFor, consentInvalidatedBy, termVersion, validateConsentInput, validateGuardian, type ConsentLike, type PersonLike } from "./rules";

const pessoa = (id: string, over: Partial<PersonLike> = {}): PersonLike => ({ id, role: "morador", relation: "morador", isMinor: false, guardianPersonId: null, ...over });
const wesley = pessoa("w", { role: "dono" });
const anna = pessoa("a");
const filho = pessoa("f", { isMinor: true, guardianPersonId: "a" });
const cliente = pessoa("c", { role: "visitante", relation: "contato_externo" });
const t = (dias: number) => new Date(Date.UTC(2026, 8, dias));
const consent = (over: Partial<ConsentLike>): ConsentLike => ({ personId: "a", kinds: ["voz"], grantedBy: "propria_pessoa", guardianPersonId: null, grantedAt: t(1), revokedAt: null, ...over });

describe("versão do termo", () => {
  it("é estável e muda quando o texto muda", () => {
    expect(termVersion("Aceito.")).toBe(termVersion("  Aceito.  "));
    expect(termVersion("Aceito.")).not.toBe(termVersion("Aceito, com ressalva."));
    expect(termVersion("x")).toHaveLength(12);
  });
});

describe("consentimento vigente", () => {
  it("adulto com consentimento de voz: ok para voz, não para rosto", () => {
    expect(consentFor(anna, [consent({})], "voz").ok).toBe(true);
    expect(consentFor(anna, [consent({})], "rosto")).toMatchObject({ ok: false });
  });

  it("revogado não vale", () => {
    expect(consentFor(anna, [consent({ revokedAt: t(2) })], "voz").ok).toBe(false);
  });

  it("vale o mais recente não revogado", () => {
    const r = consentFor(anna, [consent({ grantedAt: t(1) }), consent({ grantedAt: t(5), kinds: ["voz", "rosto"] })], "voz");
    expect(r.ok && r.consent.grantedAt).toEqual(t(5));
  });

  it("menor: consentimento dado por ele mesmo não vale", () => {
    const r = consentFor(filho, [consent({ personId: "f" })], "voz");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.motivo).toMatch(/responsável/);
  });

  it("menor: consentimento do responsável vale", () => {
    expect(consentFor(filho, [consent({ personId: "f", grantedBy: "responsavel", guardianPersonId: "a" })], "voz").ok).toBe(true);
  });

  it("menor: consentimento do responsável ANTERIOR deixa de valer quando ele muda ou sai", () => {
    const dado = [consent({ personId: "f", grantedBy: "responsavel", guardianPersonId: "a" })];
    expect(consentFor({ ...filho, guardianPersonId: "outro" }, dado, "voz").ok).toBe(false);
    expect(consentFor({ ...filho, guardianPersonId: null }, dado, "voz").ok).toBe(false);
  });

  it("menor: consentimento marcado como responsável mas sem responsável gravado não vale", () => {
    expect(consentFor(filho, [consent({ personId: "f", grantedBy: "responsavel", guardianPersonId: null })], "voz").ok).toBe(false);
  });

  it("consentimento de outra pessoa não conta", () => {
    expect(consentFor(anna, [consent({ personId: "w" })], "voz").ok).toBe(false);
  });

  it("contato externo pode consentir (decisão 9.1)", () => {
    expect(consentFor(cliente, [consent({ personId: "c", kinds: ["voz"] })], "voz").ok).toBe(true);
  });
});

describe("registro de consentimento", () => {
  it("adulto consente por si", () => {
    expect(validateConsentInput(anna, { kinds: ["voz"], grantedBy: "propria_pessoa", guardianPersonId: null }, null)).toBeNull();
    expect(validateConsentInput(anna, { kinds: ["voz"], grantedBy: "responsavel", guardianPersonId: "w" }, wesley)).toMatch(/ela mesma/);
  });

  it("sem tipo escolhido", () => {
    expect(validateConsentInput(anna, { kinds: [], grantedBy: "propria_pessoa", guardianPersonId: null }, null)).toMatch(/ao menos um/);
  });

  it("menor exige o responsável cadastrado", () => {
    expect(validateConsentInput(filho, { kinds: ["rosto"], grantedBy: "propria_pessoa", guardianPersonId: null }, null)).toMatch(/responsável/);
    expect(validateConsentInput(filho, { kinds: ["rosto"], grantedBy: "responsavel", guardianPersonId: null }, null)).toMatch(/Indique/);
    expect(validateConsentInput(filho, { kinds: ["rosto"], grantedBy: "responsavel", guardianPersonId: "w" }, wesley)).toMatch(/cadastrado desta pessoa/);
    expect(validateConsentInput(filho, { kinds: ["rosto"], grantedBy: "responsavel", guardianPersonId: "a" }, anna)).toBeNull();
  });

  it("menor sem responsável cadastrado não aceita consentimento de ninguém", () => {
    const semResp = pessoa("s", { isMinor: true });
    expect(validateConsentInput(semResp, { kinds: ["voz"], grantedBy: "responsavel", guardianPersonId: "c" }, cliente)).toMatch(/Cadastre o responsável/);
  });

  it("adulto não leva responsável no consentimento", () => {
    expect(validateConsentInput(anna, { kinds: ["voz"], grantedBy: "propria_pessoa", guardianPersonId: "w" }, wesley)).toMatch(/não tem responsável/);
  });

  it("responsável menor não vale", () => {
    const outroMenor = pessoa("m", { isMinor: true });
    const semResp = pessoa("s", { isMinor: true, guardianPersonId: "m" });
    expect(validateConsentInput(semResp, { kinds: ["voz"], grantedBy: "responsavel", guardianPersonId: "m" }, outroMenor)).toMatch(/não pode ser menor/);
  });
});

describe("perguntar sobre outra pessoa", () => {
  it("dono pode sobre todos; qualquer um sobre si", () => {
    expect(canAskAbout(wesley, anna, [], "negado")).toBe(true);
    expect(canAskAbout(anna, anna, [], "negado")).toBe(true);
  });

  it("padrão negado: morador não pergunta sobre outro morador", () => {
    expect(canAskAbout(anna, pessoa("b"), [], "negado")).toBe(false);
  });

  it("responsável pergunta sobre o menor dele", () => {
    expect(canAskAbout(anna, filho, [], "negado")).toBe(true);
    expect(canAskAbout(pessoa("b"), filho, [], "moradores_entre_si")).toBe(false);
  });

  it("regra explícita vence o padrão nos dois sentidos", () => {
    const b = pessoa("b");
    expect(canAskAbout(anna, b, [{ viewerPersonId: "a", subjectPersonId: "b", allowed: true }], "negado")).toBe(true);
    expect(canAskAbout(anna, b, [{ viewerPersonId: "a", subjectPersonId: "b", allowed: false }], "moradores_entre_si")).toBe(false);
  });

  it("política moradores entre si não abre visitante nem externo", () => {
    expect(canAskAbout(anna, pessoa("b"), [], "moradores_entre_si")).toBe(true);
    expect(canAskAbout(cliente, anna, [], "moradores_entre_si")).toBe(false);
  });

  it("quem pergunta desconhecido: nega", () => {
    expect(canAskAbout(null, anna, [], "moradores_entre_si")).toBe(false);
  });
});

describe("mudança de cadastro que derruba consentimento", () => {
  it("virar menor ou trocar o responsável de um menor", () => {
    expect(consentInvalidatedBy({ isMinor: false, guardianPersonId: null }, { isMinor: true, guardianPersonId: "a" })).toBe(true);
    expect(consentInvalidatedBy({ isMinor: true, guardianPersonId: "a" }, { isMinor: true, guardianPersonId: "b" })).toBe(true);
    expect(consentInvalidatedBy({ isMinor: true, guardianPersonId: "a" }, { isMinor: true, guardianPersonId: null })).toBe(true);
  });

  it("mudanças que não afetam quem consente", () => {
    expect(consentInvalidatedBy({ isMinor: false, guardianPersonId: null }, { isMinor: false, guardianPersonId: null })).toBe(false);
    // deixar de ser menor: o consentimento do responsável segue até a pessoa consentir por si
    expect(consentInvalidatedBy({ isMinor: true, guardianPersonId: "a" }, { isMinor: false, guardianPersonId: "a" })).toBe(false);
  });
});

describe("responsável no cadastro", () => {
  it("coerência", () => {
    expect(validateGuardian({ isMinor: true }, null, null)).toBeNull();
    expect(validateGuardian({ isMinor: true }, null, "x")).toMatch(/não encontrado/);
    expect(validateGuardian({ id: "a", isMinor: false }, anna, "a")).toMatch(/ela mesma/);
    expect(validateGuardian({ isMinor: true }, filho, "f")).toMatch(/menor/);
    expect(validateGuardian({ isMinor: true }, anna, "a")).toBeNull();
  });
});
