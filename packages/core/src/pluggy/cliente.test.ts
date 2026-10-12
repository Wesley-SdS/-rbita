import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarConnectToken, cursorDoProximo, esquecerChave, lerFaturas, lerTransacoes, obterChave, PluggyErro, saldoEmCentavos } from "./cliente";
import { validarToken, TokenRecusado } from "../connectors/por-token";
import { avisoDoStatus, enderecoDoWidget } from "./servico";

const CRED = { clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", clientSecret: "segredo-bem-comprido" };

type Rota = (url: URL, init?: RequestInit) => { status?: number; corpo: unknown } | undefined;
const chamadas: string[] = [];

function pluggy(rota: Rota) {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    chamadas.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname === "/auth") return new Response(JSON.stringify({ apiKey: `chave-${chamadas.length}` }), { status: 200 });
    const r = rota(url, init);
    if (!r) throw new Error(`rota inesperada ${url}`);
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }));
}

beforeEach(() => {
  chamadas.length = 0;
  esquecerChave(CRED.clientId);
});
afterEach(() => vi.unstubAllGlobals());

const tx = (id: string, date: string) => ({ id, date: `${date}T00:00:00.000Z`, amount: -10, type: "DEBIT" });

describe("lerTransacoes · v2 por cursor", () => {
  it("segue o cursor até o fim e junta as páginas", async () => {
    pluggy((u) => {
      if (u.pathname !== "/v2/transactions") return undefined;
      const depois = u.searchParams.get("after");
      return depois === null
        ? { corpo: { results: [tx("1", "2026-10-01")], next: "https://api.pluggy.ai/v2/transactions?accountId=x&after=CURSOR2" } }
        : { corpo: { results: [tx("2", "2026-10-02")], next: null } };
    });
    const r = await lerTransacoes(CRED, "x", "2026-09-01");
    expect(r.map((t) => t.id)).toEqual(["1", "2"]);
    expect(chamadas.filter((c) => c.includes("after=CURSOR2"))).toHaveLength(1);
  });

  it("filtra a data aqui, mesmo que a Pluggy ignore o parâmetro", async () => {
    pluggy((u) => (u.pathname === "/v2/transactions" ? { corpo: { results: [tx("velha", "2026-01-01"), tx("nova", "2026-10-05")], next: null } } : undefined));
    expect((await lerTransacoes(CRED, "x", "2026-09-01")).map((t) => t.id)).toEqual(["nova"]);
  });

  it("se o v2 recusar, cai para o endpoint legado paginado em vez de parar", async () => {
    pluggy((u) => {
      if (u.pathname === "/v2/transactions") return { status: 404, corpo: { message: "not found" } };
      if (u.pathname === "/transactions") {
        return u.searchParams.get("page") === "1"
          ? { corpo: { results: [tx("a", "2026-10-01")], totalPages: 2 } }
          : { corpo: { results: [tx("b", "2026-10-02")], totalPages: 2 } };
      }
      return undefined;
    });
    expect((await lerTransacoes(CRED, "x", "2026-09-01")).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("erro que não é do endpoint (500) NÃO cai para o legado: sobe", async () => {
    pluggy((u) => (u.pathname === "/v2/transactions" ? { status: 500, corpo: { message: "boom" } } : undefined));
    await expect(lerTransacoes(CRED, "x", "2026-09-01")).rejects.toBeInstanceOf(PluggyErro);
    expect(chamadas.some((c) => c.includes("/transactions?") && !c.includes("/v2/"))).toBe(false);
  });
});

describe("v2 de transações", () => {
  it("manda o parâmetro de data do SDK oficial (dateFrom), a conta e, na página seguinte, o cursor", async () => {
    pluggy((u) => (u.pathname === "/v2/transactions" ? { corpo: { results: [], next: null } } : undefined));
    await lerTransacoes(CRED, "conta-1", "2026-09-01");
    const pedido = chamadas.find((c) => c.includes("/v2/transactions"))!;
    expect(pedido).toContain("accountId=conta-1");
    expect(pedido).toContain("dateFrom=2026-09-01");
    expect(pedido).not.toContain("from=2026");
  });
});

describe("faturas do cartão", () => {
  it("lê as páginas até o fim", async () => {
    pluggy((u) => {
      if (u.pathname !== "/bills") return undefined;
      return u.searchParams.get("page") === "1"
        ? { corpo: { results: [{ id: "b1", dueDate: "2026-10-15", totalAmount: 100 }], totalPages: 2 } }
        : { corpo: { results: [{ id: "b2", dueDate: "2026-11-15", totalAmount: 200 }], totalPages: 2 } };
    });
    expect((await lerFaturas(CRED, "cartao-1")).map((f) => f.id)).toEqual(["b1", "b2"]);
  });
});

describe("token do widget de conexão", () => {
  it("pede o token com o item a renovar e um identificador derivado, e devolve só o accessToken", async () => {
    let corpo: { itemId?: string; options?: Record<string, unknown> } = {};
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(String(input));
      if (u.pathname === "/auth") return new Response(JSON.stringify({ apiKey: "k" }), { status: 200 });
      corpo = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ accessToken: "token-do-widget" }), { status: 200 });
    }));
    expect(await criarConnectToken(CRED, { itemId: "item-1", clientUserId: "abc" })).toBe("token-do-widget");
    expect(corpo).toMatchObject({ itemId: "item-1", options: { clientUserId: "abc", avoidDuplicates: true } });
    // o segredo nunca vai no corpo do pedido do token
    expect(JSON.stringify(corpo)).not.toContain(CRED.clientSecret);
  });

  it("sem itemId conecta um banco novo; resposta sem token é erro", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => new Response(JSON.stringify(new URL(String(input)).pathname === "/auth" ? { apiKey: "k" } : {}), { status: 200 })));
    await expect(criarConnectToken(CRED, { clientUserId: "abc" })).rejects.toBeInstanceOf(PluggyErro);
  });
});

describe("endereço do widget", () => {
  const padrao = "https://cdn.pluggy.ai/pluggy-connect/v2.3.1/pluggy-connect.js";
  it("só aceita https no domínio da Pluggy; qualquer outro endereço cai no padrão", () => {
    expect(enderecoDoWidget("https://cdn.pluggy.ai/pluggy-connect/v2.9.0/pluggy-connect.js", padrao)).toBe("https://cdn.pluggy.ai/pluggy-connect/v2.9.0/pluggy-connect.js");
    for (const ruim of ["http://cdn.pluggy.ai/x.js", "https://evil.example/pluggy-connect.js", "https://cdn.pluggy.ai.evil.com/x.js", "https://cdn.pluggy.ai/x.html", "javascript:alert(1)", "lixo"]) {
      expect(enderecoDoWidget(ruim, padrao), ruim).toBe(padrao);
    }
  });
});

describe("chave de API", () => {
  it("é reaproveitada: duas leituras, um só /auth", async () => {
    pluggy((u) => (u.pathname === "/v2/transactions" ? { corpo: { results: [], next: null } } : undefined));
    await lerTransacoes(CRED, "x", "2026-09-01");
    await lerTransacoes(CRED, "x", "2026-09-01");
    expect(chamadas.filter((c) => c.startsWith("POST /auth"))).toHaveLength(1);
  });

  it("chave vencida antes da hora (401): renova uma vez e repete", async () => {
    let primeira = true;
    pluggy((u) => {
      if (u.pathname !== "/v2/transactions") return undefined;
      if (primeira) { primeira = false; return { status: 401, corpo: {} }; }
      return { corpo: { results: [tx("1", "2026-10-01")], next: null } };
    });
    expect(await lerTransacoes(CRED, "x", "2026-09-01")).toHaveLength(1);
    expect(chamadas.filter((c) => c.startsWith("POST /auth"))).toHaveLength(2);
  });

  it("credencial errada vira mensagem em português, sem vazar o segredo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ codeDescription: "CLIENT_KEYS_UNAUTHORIZED" }), { status: 401 })));
    const erro = await obterChave(CRED, true).catch((e) => e as Error);
    expect(erro).toBeInstanceOf(PluggyErro);
    expect((erro as Error).message).toMatch(/recusou o clientId e o clientSecret/);
    expect((erro as Error).message).not.toContain(CRED.clientSecret);
  });
});

describe("conexão por credencial", () => {
  it("só guarda depois de a Pluggy aceitar o par, e o segredo vai no formato que o serviço lê", async () => {
    pluggy(() => undefined);
    const c = await validarToken("pluggy", { clientId: CRED.clientId, clientSecret: CRED.clientSecret });
    expect(c.externalId).toBe(CRED.clientId);
    expect(JSON.parse(c.segredo)).toEqual(CRED);
  });

  it("par recusado, id fora do formato ou segredo curto não viram conexão", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ codeDescription: "CLIENT_KEYS_UNAUTHORIZED" }), { status: 401 })));
    await expect(validarToken("pluggy", CRED)).rejects.toBeInstanceOf(TokenRecusado);
    await expect(validarToken("pluggy", { clientId: "abc", clientSecret: CRED.clientSecret })).rejects.toThrow(/Client ID/);
    await expect(validarToken("pluggy", { clientId: CRED.clientId, clientSecret: "x" })).rejects.toThrow(/Client Secret/);
  });
});

describe("pequenos tradutores", () => {
  it("cursor vem como URL ou como valor, e acaba em null", () => {
    expect(cursorDoProximo("https://api.pluggy.ai/v2/transactions?accountId=x&after=ABC")).toBe("ABC");
    expect(cursorDoProximo("ABC")).toBe("ABC");
    expect(cursorDoProximo(null)).toBeNull();
    expect(cursorDoProximo("")).toBeNull();
  });

  it("saldo em reais vira centavos inteiros", () => {
    expect(saldoEmCentavos(3454.1)).toBe(345410);
    expect(saldoEmCentavos(0.29)).toBe(29);
    expect(saldoEmCentavos(null)).toBeNull();
  });

  it("status do item vira o que fazer, e item saudável não avisa nada", () => {
    expect(avisoDoStatus("LOGIN_ERROR")).toMatch(/recusou o acesso/);
    expect(avisoDoStatus("WAITING_USER_INPUT")).toMatch(/confirmação/);
    expect(avisoDoStatus("OUTDATED")).toMatch(/desatualizados/);
    expect(avisoDoStatus("UPDATED", "SUCCESS")).toBeNull();
  });
});
