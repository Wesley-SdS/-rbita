import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@orbita/db/schema";
import { biometricTables, identifiedRefs } from "./erase";

/**
 * "Apagar é apagar" (PRD §4.5) garantido pelo schema: qualquer tabela que
 * aponta para `person` some junto com a pessoa, exceto referências que só
 * perdem o vínculo DE PROPÓSITO (listadas aqui com o motivo). Tabela nova das
 * Ondas 9 e 10 que esquecer o cascade reprova aqui, antes de guardar biometria.
 */
const tabelas = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable)).map((t) => getTableConfig(t));

/** "tabela.coluna" que aponta para person com set null, e por quê. */
const SET_NULL_INTENCIONAL: Record<string, string> = {
  "person.guardian_person_id": "o menor continua cadastrado se o responsável sair; consentFor só aceita consentimento do responsável ATUAL, então o dado pelo antigo deixa de valer",
  "biometric_consent.guardian_person_id": "o nome do responsável fica gravado no consentimento (guardian_name)",
  "identity_audit.actor_person_id": "a trilha sobre OUTRA pessoa não some porque quem perguntou saiu",
};

describe("apagar pessoa no schema", () => {
  const fks = tabelas.flatMap((cfg) =>
    cfg.foreignKeys
      .map((fk) => fk.reference())
      .filter((ref) => getTableConfig(ref.foreignTable).name === "person")
      .map((ref) => ({ chave: `${cfg.name}.${ref.columns[0]!.name}`, onDelete: cfg.foreignKeys.find((f) => f.reference().columns[0] === ref.columns[0])!.onDelete })),
  );

  it("existe FK para person (o teste enxerga o schema)", () => {
    expect(fks.length).toBeGreaterThan(3);
  });

  it("toda FK para person é cascade, ou set null intencional e documentado", () => {
    for (const fk of fks) {
      if (fk.onDelete === "cascade") continue;
      expect(SET_NULL_INTENCIONAL[fk.chave], `${fk.chave} (${fk.onDelete}) deixaria dado da pessoa para trás`).toBeDefined();
      expect(fk.onDelete).toBe("set null");
    }
  });

  it("toda tabela biometric_* tem person_id com cascade", () => {
    for (const b of biometricTables()) {
      const fk = fks.find((f) => f.chave === `${b.name}.person_id`);
      expect(fk?.onDelete, b.name).toBe("cascade");
    }
  });

  it("toda coluna identified_person_id aceita null (é zerada ao apagar)", () => {
    for (const r of identifiedRefs()) {
      expect(r.personColumn.notNull, r.name).toBe(false);
      expect(Object.keys(r.columns).length, r.name).toBeGreaterThan(0);
    }
  });
});
