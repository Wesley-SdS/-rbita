import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@orbita/db/schema";
import { ORPHAN_BY_DESIGN, erasedByCascade, omittedReason, userOwnedTables } from "./data";

/**
 * Rede de segurança do "apagar é apagar tudo" (RV.6 e PRD §4.5): toda tabela
 * nova com dado de usuário entra sozinha no apagar e no exportar. Sem banco:
 * só introspecção do schema Drizzle.
 */
describe("dados da conta derivados do schema", () => {
  const owned = userOwnedTables();
  const nomes = owned.map((t) => t.name);

  it("inclui tabelas diretas e as ligadas por FK", () => {
    expect(nomes).toEqual(expect.arrayContaining(["conversation", "memory", "camera_event", "person", "event_log"]));
    // sem user_id, mas do usuário por FK
    expect(nomes).toEqual(expect.arrayContaining(["message", "person_room_access"]));
  });

  it("não trata config global como dado de usuário", () => {
    expect(nomes).not.toContain("setting");
    expect(nomes).not.toContain("tool_config");
  });

  it("toda tabela com user_id aparece na lista", () => {
    const comUserId = Object.values(schema)
      .filter((v) => typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v)
      .map((t) => getTableConfig(t as Parameters<typeof getTableConfig>[0]))
      .filter((c) => c.columns.some((col) => col.name === "user_id"))
      .map((c) => c.name);
    for (const n of comUserId) expect(nomes).toContain(n);
  });

  it("tudo some com a conta: por cascade, pela limpeza explícita do event_log, ou é órfão de propósito", () => {
    const naoCascade = owned.filter((t) => !erasedByCascade(t)).map((t) => t.name).sort();
    // event_log: sem FK (evento de sistema não tem dono), limpo em eraseAccount
    // instance_owner: set null intencional (posse órfã, ninguém é promovido)
    expect(naoCascade).toEqual(["event_log", "instance_owner"]);
    expect([...ORPHAN_BY_DESIGN]).toEqual(["instance_owner"]);
  });

  it("set null só é aceito com exceção explícita", () => {
    const setNull = owned.filter((t) => t.onDelete === "set null").map((t) => t.name);
    for (const n of setNull) expect(ORPHAN_BY_DESIGN.has(n), `${n} deixaria dado pessoal para trás`).toBe(true);
  });
});

describe("o que fica fora do export", () => {
  it("credenciais, cifradas ou não", () => {
    for (const col of ["access_token_enc", "refresh_token_enc", "token_enc", "webhook_token", "token", "password", "id_token", "headers", "p256dh", "auth"]) {
      expect(omittedReason("qualquer", col), col).not.toBeNull();
    }
  });

  it("vetor de texto e snapshot de câmera", () => {
    expect(omittedReason("memory", "embedding")).not.toBeNull();
    expect(omittedReason("camera_event", "snapshot")).not.toBeNull();
  });

  it("dado comum sai normalmente", () => {
    for (const col of ["content", "name", "label", "amount_cents", "author", "created_at", "provider", "access_token_expires_at", "authorized_by"]) {
      expect(omittedReason("qualquer", col), col).toBeNull();
    }
  });
});

/**
 * "Biometria nunca sai de casa" (CLAUDE.md §5.4.1) vale também para "exportar
 * meus dados", que é uma saída como qualquer outra. Citar duas colunas à mão
 * (era o que este arquivo fazia) deixava o export vazar vetor biométrico sem
 * ninguém ficar sabendo: aqui a lista sai do SCHEMA, então uma tabela
 * `biometric_*` nova reprova sozinha se alguém esquecer de omitir a assinatura.
 */
describe("assinatura biométrica fora do export, derivada do schema", () => {
  const biometricas = Object.values(schema)
    .filter((v) => typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v)
    .map((t) => getTableConfig(t as Parameters<typeof getTableConfig>[0]))
    .filter((c) => c.name.startsWith("biometric_"));

  it("a derivação acha as tabelas biométricas (não passa por lista vazia)", () => {
    expect(biometricas.map((c) => c.name)).toEqual(expect.arrayContaining(["biometric_voice_embedding", "biometric_face_embedding"]));
    expect(biometricas.length).toBeGreaterThanOrEqual(4);
  });

  // a assinatura é sempre um array NUMÉRICO (real[]): um modelo por dimensão,
  // sem pgvector. `biometric_consent.kinds` é text[] e é o oposto de segredo:
  // é o registro do que a pessoa autorizou, e tem que sair no export dela.
  const ehVetor = (tipo: string) => /^(real|double precision|numeric|integer|smallint|bigint)\[\]$/.test(tipo);

  it("toda coluna de vetor de tabela biométrica é omitida", () => {
    let checadas = 0;
    for (const t of biometricas) {
      for (const col of t.columns.filter((c) => ehVetor(c.getSQLType()))) {
        checadas++;
        expect(omittedReason(t.name, col.name), `${t.name}.${col.name} sairia no export`).not.toBeNull();
      }
    }
    expect(checadas, "nenhuma coluna de vetor encontrada: a derivação quebrou").toBeGreaterThanOrEqual(4);
  });

  it("a amostra bruta guardada (áudio e foto cifrados) também não sai", () => {
    const amostras = biometricas.flatMap((t) => t.columns.filter((c) => /_enc$/.test(c.name)).map((c) => [t.name, c.name] as const));
    expect(amostras.length, "nenhuma amostra cifrada encontrada").toBeGreaterThanOrEqual(2);
    for (const [tabela, col] of amostras) expect(omittedReason(tabela, col), `${tabela}.${col}`).not.toBeNull();
  });

  it("o que descreve a assinatura (modelo, backend, dimensão) fica junto com ela", () => {
    // vetor sem o modelo que o gerou não se compara com nada: exportar um sem o
    // outro seria exportar meia assinatura, e meia assinatura também é biometria
    let checadas = 0;
    for (const t of biometricas) {
      for (const col of t.columns.filter((c) => ["model", "backend", "dim"].includes(c.name))) {
        checadas++;
        expect(omittedReason(t.name, col.name), `${t.name}.${col.name} sairia no export`).not.toBeNull();
      }
    }
    expect(checadas).toBeGreaterThanOrEqual(4);
  });

  it("o resto da tabela biométrica continua saindo: apagar e exportar não viram 'some tudo'", () => {
    // sem isto, omitir a tabela inteira passaria no teste e o dono perderia o
    // que é dele (quando cadastrou, de onde veio, o rótulo do desconhecido)
    for (const col of ["created_at", "source", "label", "person_id", "source_ref"]) {
      expect(omittedReason("biometric_voice_sample", col), col).toBeNull();
    }
  });

  it("a regra vale por prefixo: tabela biométrica nova entra sozinha", () => {
    expect(omittedReason("biometric_marcha_embedding", "vector")).not.toBeNull();
    // e não transborda: `vector` de uma tabela que não é biométrica não é assinatura
    expect(omittedReason("qualquer", "vector")).toBeNull();
    // consentimento mora numa tabela `biometric_*` e é o oposto de segredo:
    // é a prova do que a pessoa autorizou, e sai no export dela
    expect(omittedReason("biometric_consent", "kinds")).toBeNull();
    expect(omittedReason("biometric_consent", "granted_by")).toBeNull();
  });
});
