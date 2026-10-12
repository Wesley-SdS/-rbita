import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rotas do Chrome do dono (B1, B2, B6, B7). Travado: tudo é só do dono
 * (OwnerGuard); a categoria da própria Órbita não aparece como opção (é fixa);
 * revogar derruba a extensão na hora; a ponte se instala e remove pela tela com
 * o MESMO instalador; e o perfil dedicado se apaga pela tela.
 */

let dono = true;
vi.mock("@orbita/core/owner", () => ({ isOwner: async () => dono }));
const cfg: Record<string, unknown> = { "navegador.padraoSite": "leitura", "navegador.categoriasBloqueadas": ["bancos"], "navegador.extensaoId": "" };
vi.mock("@orbita/core/settings/index", () => ({ settings: { get: async (k: string) => cfg[k], getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, cfg[k]])) } }));
const revogarExtensao = vi.fn(async (_u: string, id: string) => (id === "11111111-1111-4111-8111-111111111111" ? { id } : null));
vi.mock("@orbita/core/navegador/pareamento", () => ({ codigoPendente: () => null, gerarCodigo: () => ({ codigo: "123456", expiraEm: "x" }), listarExtensoes: async () => [], revogarExtensao, VALIDADE_DO_CODIGO_MS: 300_000 }));
const derrubarExtensao = vi.fn(() => 1);
vi.mock("@orbita/core/navegador/canal", () => ({ conectadaPelaPonte: () => false, derrubarExtensao, extensaoConectada: () => false, reenviarSites: async () => undefined }));
vi.mock("@orbita/core/navegador/sites", () => ({ definirSite: async () => ({}), listarSites: async () => [], MODOS: ["bloqueado", "leitura", "escrita"], removerSite: async () => true, SiteInvalidoError: class extends Error {} }));
vi.mock("@orbita/core/navegador/roteiros", () => ({ listarRoteiros: async () => [], removerRoteiro: async () => true }));
const mudarPonte = vi.fn(async (acao: string) => ({ instalada: acao === "instalar", segredo: acao === "instalar", manifesto: acao === "instalar" }));
vi.mock("@orbita/core/navegador/ponte", () => ({ estadoDaPonte: async () => ({ instalada: true, segredo: true, manifesto: true }), mudarPonte }));
const apagarPerfilDedicado = vi.fn(async () => ({ pasta: "x", apagada: true }));
vi.mock("@orbita/core/navegador/dedicado", () => ({ abrirDedicado: async () => ({ pages: () => [1] }), apagarPerfilDedicado, fecharDedicado: async () => undefined }));

const rota = await import("./navegador");
const ctx = { params: {}, user: { id: "u1", email: "d@x", name: "Dono" } };
const anonimo = { params: {}, user: null } as never;
const post = (corpo: unknown) => new Request("http://127.0.0.1:3010/api/navegador/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });

beforeEach(() => {
  vi.clearAllMocks();
  dono = true;
});

describe("rotas do Chrome", () => {
  it("só o dono: 401 sem sessão, 403 para outra conta, em todas", async () => {
    for (const r of [rota.GET_EXTENSOES, rota.GET_SITES, rota.GET_PONTE, rota.GET_ROTEIROS]) expect((await r(new Request("http://x"), anonimo)).status).toBe(401);
    dono = false;
    expect((await rota.POST_PONTE(post({ acao: "instalar" }), ctx)).status).toBe(403);
    expect((await rota.POST_DEDICADO(post({ acao: "apagar" }), ctx)).status).toBe(403);
    expect((await rota.POST_PAREAR(post({}), ctx)).status).toBe(403);
    expect(mudarPonte).not.toHaveBeenCalled();
    expect(apagarPerfilDedicado).not.toHaveBeenCalled();
  });

  it("a categoria da Órbita é fixa: sempre bloqueada, e nunca uma opção da tela (I-1)", async () => {
    const r = (await (await rota.GET_SITES(new Request("http://x"), ctx)).json()) as { categorias: string[]; categoriasConhecidas: string[]; categoriasFixas: string[] };
    expect(r.categorias).toContain("orbita");
    expect(r.categoriasConhecidas).not.toContain("orbita");
    expect(r.categoriasFixas).toEqual(["orbita"]);
  });

  it("revogar derruba a extensão na hora; id torto é 400 e o que não existe é 404", async () => {
    const ok = await rota.DELETE_EXTENSAO(new Request("http://x", { method: "DELETE" }), { ...ctx, params: { id: "11111111-1111-4111-8111-111111111111" } });
    expect(ok.status).toBe(200);
    expect(derrubarExtensao).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect((await rota.DELETE_EXTENSAO(new Request("http://x"), { ...ctx, params: { id: "x" } })).status).toBe(400);
    expect((await rota.DELETE_EXTENSAO(new Request("http://x"), { ...ctx, params: { id: "22222222-2222-4222-8222-222222222222" } })).status).toBe(404);
  });

  it("a ponte: estado na tela, instalar e remover pelo mesmo instalador; ação torta é 400 (I-14)", async () => {
    expect(await (await rota.GET_PONTE(new Request("http://x"), ctx)).json()).toMatchObject({ instalada: true, segredo: true, ativa: false });
    expect(await (await rota.POST_PONTE(post({ acao: "instalar" }), ctx)).json()).toMatchObject({ instalada: true });
    expect(await (await rota.POST_PONTE(post({ acao: "remover" }), ctx)).json()).toMatchObject({ instalada: false, segredo: false });
    expect(mudarPonte.mock.calls.map((c) => c[0])).toEqual(["instalar", "remover"]);
    expect((await rota.POST_PONTE(post({ acao: "rodar-qualquer-coisa" }), ctx)).status).toBe(400);
  });

  it("o perfil dedicado se apaga pela tela (cookies e logins)", async () => {
    const r = await rota.POST_DEDICADO(post({ acao: "apagar" }), ctx);
    expect(r.status).toBe(200);
    expect(apagarPerfilDedicado).toHaveBeenCalledOnce();
    expect((await rota.POST_DEDICADO(post({ acao: "explodir" }), ctx)).status).toBe(400);
  });
});
