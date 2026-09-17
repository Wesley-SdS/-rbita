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

  it("vetor e snapshot de câmera", () => {
    expect(omittedReason("memory", "embedding")).not.toBeNull();
    expect(omittedReason("camera_event", "snapshot")).not.toBeNull();
  });

  it("dado comum sai normalmente", () => {
    for (const col of ["content", "name", "label", "amount_cents", "author", "created_at", "provider", "access_token_expires_at", "authorized_by"]) {
      expect(omittedReason("qualquer", col), col).toBeNull();
    }
  });
});
