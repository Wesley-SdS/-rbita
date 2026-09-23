import { describe, it, expect } from "vitest";
import { corpoDoIdToken, identidadeDaConta, rotuloDeExibicao } from "./identidade";

/** Monta um id_token de mentira, só com o corpo (é o que o código lê). */
function idToken(corpo: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(corpo), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `cabecalho.${b64}.assinatura`;
}

describe("o corpo do id_token", () => {
  it("lê o JWT em base64url", () => {
    expect(corpoDoIdToken(idToken({ sub: "123", email: "wesley@orbita.local" }))).toEqual({ sub: "123", email: "wesley@orbita.local" });
  });

  it("token faltando, torto ou com lixo não quebra", () => {
    for (const t of [undefined, "", "só-uma-parte", "a.@@@.c", "a.eyJub3QtanNvbg.c"]) {
      expect(corpoDoIdToken(t)).toBeNull();
    }
  });
});

describe("a identidade de cada provedor", () => {
  it("Google e Microsoft vêm do id_token", () => {
    const g = identidadeDaConta("google", { id_token: idToken({ sub: "g-1", email: "wesley@gmail.com" }) });
    expect(g).toEqual({ externalId: "g-1", label: "wesley@gmail.com" });

    const m = identidadeDaConta("microsoft", { id_token: idToken({ oid: "m-1", preferred_username: "wesley@empresa.com" }) });
    expect(m).toEqual({ externalId: "m-1", label: "wesley@empresa.com" });
  });

  it("a chave é o `sub`, não o e-mail", () => {
    // e-mail muda de dono e é reaproveitado; `sub` é imutável. Usar e-mail como
    // chave faria duas contas diferentes colidirem na mesma linha.
    const a = identidadeDaConta("google", { id_token: idToken({ sub: "g-1", email: "antigo@x.com" }) });
    const b = identidadeDaConta("google", { id_token: idToken({ sub: "g-2", email: "antigo@x.com" }) });
    expect(a.externalId).not.toBe(b.externalId);
  });

  it("Slack usa o workspace, Notion também", () => {
    expect(identidadeDaConta("slack", { team: { id: "T01", name: "Adalink" } })).toEqual({ externalId: "T01", label: "Adalink" });
    expect(identidadeDaConta("notion", { workspace_id: "w1", workspace_name: "Casa" })).toEqual({ externalId: "w1", label: "Casa" });
  });

  it("provedor sem identificador degrada para conta única, não quebra", () => {
    expect(identidadeDaConta("qualquer", {})).toEqual({ externalId: "", label: null });
    expect(identidadeDaConta("google", {})).toEqual({ externalId: "", label: null });
  });
});

describe("como a conta aparece na tela", () => {
  it("o rótulo do provedor ganha quando existe", () => {
    expect(rotuloDeExibicao("wesley@gmail.com", 2)).toBe("wesley@gmail.com");
  });
  it("sem rótulo, duas contas ainda são distinguíveis", () => {
    expect(rotuloDeExibicao(null, 1)).toBe("Conta conectada");
    expect(rotuloDeExibicao(null, 2)).toBe("Conta 2");
  });
});
