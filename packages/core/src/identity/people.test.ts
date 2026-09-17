import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O que `rules.test.ts` NÃO cobre: o encadeamento com banco. A regra pura já
 * sabe dizer "isso invalida o consentimento"; aqui se prova que `people.ts`
 * age sobre essa resposta (revoga e deixa trilha) e que as duas travas que só
 * existem neste arquivo funcionam: o termo aceito é o termo que estava na tela,
 * e uma conta de login pertence a uma pessoa só.
 *
 * O banco é um dublê de cadeia Drizzle (fila de respostas por tabela): a suíte
 * roda numa máquina saturada e subir Postgres por teste de lógica é caro demais.
 */

const fake = vi.hoisted(() => {
  type Consulta = { op: string; tabela: unknown; calls: Record<string, unknown[]> };
  const consultas: Consulta[] = [];
  const fila: { op: string; tabela: unknown; rows: unknown[] }[] = [];
  const metodos = ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "values", "set", "returning", "onConflictDoUpdate"];

  function cadeia(op: string, tabela?: unknown) {
    const q: Consulta = { op, tabela, calls: {} };
    consultas.push(q);
    const p: Record<string, unknown> = {
      // a cadeia é "thenable": o await resolve com a resposta enfileirada para
      // aquela tabela, do jeito que o Drizzle resolve ao ser aguardado
      then: (ok: (v: unknown[]) => void) => {
        const i = fila.findIndex((f) => f.tabela === q.tabela && f.op === q.op);
        ok(i >= 0 ? fila.splice(i, 1)[0]!.rows : []);
      },
    };
    for (const m of metodos) {
      p[m] = (...args: unknown[]) => {
        q.calls[m] = args;
        if (m === "from") q.tabela = args[0];
        return p;
      };
    }
    return p;
  }

  const db = {
    select: () => cadeia("select"),
    insert: (t: unknown) => cadeia("insert", t),
    update: (t: unknown) => cadeia("update", t),
    delete: (t: unknown) => cadeia("delete", t),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  return {
    db,
    consultas,
    fila,
    termo: { texto: "Autorizo a Órbita a reconhecer minha voz e meu rosto nesta casa." },
    emitidos: [] as unknown[][],
    reset() {
      consultas.length = 0;
      fila.length = 0;
      fake.emitidos.length = 0;
      fake.termo.texto = "Autorizo a Órbita a reconhecer minha voz e meu rosto nesta casa.";
    },
    /** Próxima leitura desta tabela responde estas linhas (na ordem enfileirada). */
    responder(tabela: unknown, rows: unknown[], op = "select") {
      fila.push({ op, tabela, rows });
    },
    achar(op: string, tabela: unknown) {
      return consultas.find((q) => q.op === op && q.tabela === tabela);
    },
    valores(op: string, tabela: unknown) {
      return fake.achar(op, tabela)?.calls[op === "insert" ? "values" : "set"]?.[0] as Record<string, unknown> | undefined;
    },
  };
});

vi.mock("@orbita/db", () => ({ db: fake.db }));
vi.mock("../settings", () => ({ settings: { get: async () => fake.termo.texto, getMany: async () => ({}) } }));
vi.mock("../events/index", () => ({
  events: {
    emit: async (...args: unknown[]) => {
      fake.emitidos.push(args);
    },
  },
}));
// voz e rosto puxam percepção e criptografia: nada disso participa destes casos
vi.mock("./voice", () => ({ forgetVoiceTraces: vi.fn(async () => ({ desconhecidos: 0, refs: 0 })) }));
vi.mock("./face", () => ({ forgetFaceTraces: vi.fn(async () => ({ desconhecidos: 0 })) }));

import { user } from "@orbita/db/auth-schema";
import { person } from "@orbita/db/home-schema";
import { biometricConsent, identityAudit } from "@orbita/db/identity-schema";
import { IdentityError } from "./errors";
import { termVersion } from "./rules";
import { recordConsent, updatePerson } from "./people";

const DONO = "dono-1";
const linhaPessoa = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  userId: DONO,
  name: "Anna",
  role: "morador",
  relation: "morador",
  isMinor: false,
  guardianPersonId: null,
  accountUserId: null,
  ...over,
});

beforeEach(() => fake.reset());

describe("consentimento: vale o termo que estava na tela", () => {
  const aceite = (over: Record<string, unknown> = {}) => ({
    personId: "p1",
    kinds: ["voz"] as ("voz" | "rosto")[],
    grantedBy: "propria_pessoa" as const,
    guardianPersonId: null,
    termVersion: termVersion(fake.termo.texto),
    ...over,
  });

  it("recusa quando o termo mudou entre mostrar e aceitar", async () => {
    fake.responder(person, [linhaPessoa()]);
    const antigo = termVersion("Texto antigo do termo.");

    await expect(recordConsent(DONO, "conta-1", aceite({ termVersion: antigo }))).rejects.toThrow(/termo de consentimento mudou/i);
    // o ponto do teste: não grava consentimento nenhum com a versão errada
    expect(fake.achar("insert", biometricConsent)).toBeUndefined();
  });

  it("grava consentimento e trilha juntos quando a versão bate", async () => {
    fake.responder(person, [linhaPessoa()]);
    fake.responder(biometricConsent, [{ id: "c1" }], "insert");

    const r = await recordConsent(DONO, "conta-1", aceite());

    expect(r).toEqual({ id: "c1" });
    const gravado = fake.valores("insert", biometricConsent)!;
    expect(gravado.termVersion).toBe(termVersion(fake.termo.texto));
    // o texto aceito fica guardado junto: mudar o termo depois não reescreve o passado
    expect(gravado.termText).toBe(fake.termo.texto);
    expect(gravado.recordedByUserId).toBe("conta-1");
    expect(fake.valores("insert", identityAudit)).toMatchObject({ action: "consentimento", outcome: "concedido" });
    expect(fake.emitidos[0]?.[0]).toBe("identity.consent_granted");
  });

  it("termo vazio não vira consentimento, mesmo com a versão certa", async () => {
    fake.termo.texto = "   ";
    fake.responder(person, [linhaPessoa()]);

    await expect(recordConsent(DONO, "conta-1", aceite({ termVersion: termVersion("   ") }))).rejects.toThrow(/termo de consentimento está vazio/i);
    expect(fake.achar("insert", biometricConsent)).toBeUndefined();
  });

  it("menor: grava o nome do responsável que consentiu", async () => {
    fake.responder(person, [linhaPessoa({ isMinor: true, guardianPersonId: "g1" })]);
    fake.responder(person, [linhaPessoa({ id: "g1", name: "Wesley" })]);
    fake.responder(biometricConsent, [{ id: "c2" }], "insert");

    await recordConsent(DONO, "conta-1", aceite({ grantedBy: "responsavel", guardianPersonId: "g1" }));

    expect(fake.valores("insert", biometricConsent)).toMatchObject({ grantedBy: "responsavel", guardianPersonId: "g1", guardianName: "Wesley" });
  });

  it("pessoa de outra conta não existe aqui", async () => {
    await expect(recordConsent(DONO, "conta-1", aceite())).rejects.toMatchObject({ status: 404 });
  });
});

describe("mudar o cadastro derruba o consentimento de quem não pode mais consentir", () => {
  it("virar menor revoga o que estava vigente e registra o motivo", async () => {
    fake.responder(person, [linhaPessoa()]);
    fake.responder(person, [linhaPessoa({ id: "g1", name: "Wesley" })]); // responsável indicado
    fake.responder(biometricConsent, [{ id: "c1" }], "update");

    await updatePerson(DONO, "p1", { isMinor: true, guardianPersonId: "g1" });

    const revogacao = fake.valores("update", biometricConsent)!;
    expect(revogacao.revokedAt).toBeInstanceOf(Date);
    expect(fake.valores("insert", identityAudit)).toMatchObject({ action: "revogacao", outcome: "revogado", personId: "p1" });
  });

  it("trocar o responsável de um menor também revoga", async () => {
    fake.responder(person, [linhaPessoa({ isMinor: true, guardianPersonId: "g1" })]);
    fake.responder(person, [linhaPessoa({ id: "g2", name: "Anna Clara" })]);
    fake.responder(biometricConsent, [{ id: "c1" }], "update");

    await updatePerson(DONO, "p1", { guardianPersonId: "g2" });

    expect(fake.valores("update", biometricConsent)?.revokedAt).toBeInstanceOf(Date);
  });

  it("mudança inofensiva (só o nome) não mexe em consentimento", async () => {
    fake.responder(person, [linhaPessoa()]);

    await updatePerson(DONO, "p1", { name: "Anna Clara" });

    expect(fake.valores("update", person)).toMatchObject({ name: "Anna Clara" });
    expect(fake.achar("update", biometricConsent)).toBeUndefined();
    expect(fake.achar("insert", identityAudit)).toBeUndefined();
  });

  it("não deixa virar menor quem é responsável por alguém", async () => {
    fake.responder(person, [linhaPessoa()]);
    // sem responsável no patch, `checkGuardian` nem consulta: a leitura seguinte é a do dependente
    fake.responder(person, [{ name: "Pedro" }]);

    await expect(updatePerson(DONO, "p1", { isMinor: true })).rejects.toThrow(/responsável por Pedro/);
  });
});

describe("uma conta de login pertence a uma pessoa só", () => {
  it("recusa com 409 a conta já vinculada a outra pessoa", async () => {
    fake.responder(person, [linhaPessoa()]);
    fake.responder(user, [{ id: "conta-9" }]);
    fake.responder(person, [{ name: "Wesley" }]);

    const erro = await updatePerson(DONO, "p1", { accountEmail: "wesley@orbita.local" }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(IdentityError);
    expect(erro).toMatchObject({ status: 409 });
    expect((erro as Error).message).toMatch(/já está vinculada a Wesley/);
    // conflito antes de escrever: o cadastro não pode ficar meio mudado
    expect(fake.achar("update", person)).toBeUndefined();
  });

  it("e-mail sem conta na Órbita é 404, não vínculo vazio", async () => {
    fake.responder(person, [linhaPessoa()]);
    fake.responder(user, []);

    await expect(updatePerson(DONO, "p1", { accountEmail: "ninguem@orbita.local" })).rejects.toMatchObject({ status: 404 });
    expect(fake.achar("update", person)).toBeUndefined();
  });

  it("e-mail vazio desvincula sem procurar conta nenhuma", async () => {
    fake.responder(person, [linhaPessoa({ accountUserId: "conta-9" })]);

    await updatePerson(DONO, "p1", { accountEmail: null });

    expect(fake.achar("select", user)).toBeUndefined();
    expect(fake.valores("update", person)).toMatchObject({ accountUserId: null });
    // `accountEmail` é campo de entrada, não coluna: não pode vazar para o UPDATE
    expect(fake.valores("update", person)).not.toHaveProperty("accountEmail");
  });
});
