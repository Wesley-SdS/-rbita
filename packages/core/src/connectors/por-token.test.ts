import { afterEach, describe, expect, it, vi } from "vitest";
import { lerAcessoBasico, siteDoJira, TokenRecusado, validarToken } from "./por-token";

/**
 * Conectar colando um token (decisão do dono, 06/10/2026). Travado: o token é
 * conferido no serviço antes de ser guardado, dois tokens da mesma pessoa no
 * GitHub são duas conexões, o Jira guarda site + e-mail + token, e o Slack só
 * aceita token de USUÁRIO.
 */

function responder(rotas: Record<string, { status?: number; corpo: unknown }>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const chave = Object.keys(rotas).find((k) => String(url).includes(k));
    if (!chave) throw new Error(`rota inesperada ${url}`);
    const r = rotas[chave]!;
    (responder as unknown as { ultimo?: RequestInit }).ultimo = init;
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("GitHub por token", () => {
  it("confere quem é, e dois tokens da mesma pessoa viram duas conexões", async () => {
    responder({ "api.github.com/user": { corpo: { id: 42, login: "wesley" } } });
    const a = await validarToken("github", { token: "github_pat_aaaaaaaaaaaaaaaaaaaaaaaa" });
    const b = await validarToken("github", { token: "github_pat_bbbbbbbbbbbbbbbbbbbbbbbb" });
    expect(a).toMatchObject({ label: "wesley", segredo: "github_pat_aaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(a.externalId.startsWith("42:")).toBe(true);
    expect(a.externalId).not.toBe(b.externalId);
  });

  it("token recusado diz o motivo em vez de virar conexão", async () => {
    responder({ "api.github.com/user": { status: 401, corpo: {} } });
    await expect(validarToken("github", { token: "ghp_xxxxxxxxxxxxxxxxxxxxxxxx" })).rejects.toThrow(/recusou o token/);
    await expect(validarToken("github", { token: "curto" })).rejects.toBeInstanceOf(TokenRecusado);
  });
});

describe("Jira por token de API", () => {
  it("o endereço vira o site, e o segredo guarda site, e-mail e token", async () => {
    responder({ "/rest/api/3/myself": { corpo: { accountId: "abc", displayName: "Wesley" } } });
    const c = await validarToken("jira", { site: "Empresa.atlassian.net/jira/your-work", email: "w@empresa.com", token: "ATATT123456789" });
    expect(c).toMatchObject({ externalId: "empresa.atlassian.net", label: "empresa" });
    expect(lerAcessoBasico(c.segredo)).toEqual({ modo: "basico", site: "https://empresa.atlassian.net", email: "w@empresa.com", token: "ATATT123456789" });
  });

  it("endereço inválido e campos faltando param antes de chamar o Jira", async () => {
    expect(siteDoJira("http://")).toBeNull();
    expect(siteDoJira("localhost")).toBeNull();
    await expect(validarToken("jira", { site: "x", email: "w@e.com", token: "ATATT123456789" })).rejects.toThrow(/endereço do Jira/);
    await expect(validarToken("jira", { site: "e.atlassian.net", email: "sem-arroba", token: "t" })).rejects.toThrow(/e-mail/);
  });

  it("segredo de OAuth comum não é confundido com acesso básico", () => {
    expect(lerAcessoBasico("eyJhbGciOi.token.oauth")).toBeNull();
    expect(lerAcessoBasico('{"modo":"outro"}')).toBeNull();
  });
});

describe("Slack por token", () => {
  it("só token de usuário, e o id é o do workspace (o mesmo do OAuth)", async () => {
    responder({ "auth.test": { corpo: { ok: true, team_id: "T1", team: "Empresa", user_id: "U9" } } });
    await expect(validarToken("slack", { token: "xoxb-bot" })).rejects.toThrow(/USUÁRIO/);
    expect(await validarToken("slack", { token: "xoxp-123" })).toEqual({ externalId: "T1", label: "Empresa", segredo: "xoxp-123" });
  });

  it("o Slack responde 200 com ok:false quando o token não vale", async () => {
    responder({ "auth.test": { corpo: { ok: false, error: "invalid_auth" } } });
    await expect(validarToken("slack", { token: "xoxp-velho" })).rejects.toThrow(/invalid_auth/);
  });
});
