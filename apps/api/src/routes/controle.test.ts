import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rotas do controle do PC (PRD F6 e F7). Travado: tudo exige sessão (401);
 * a trilha só de sessão do próprio dono (404 para a de outro); o "parar"
 * delega ao core; a fala na voz só para quando o core diz que é "para".
 */

const pararTudo = vi.fn(async (..._a: unknown[]) => ({ sessoes: 1, propostas: 2, maos: [{ nome: "maos", ok: true }] }));
const pararPorFrase = vi.fn(async (_u: string, _c: string, fala: string) => (fala === "para" ? { estado: "parado" as const, texto: "Parei." } : null));
vi.mock("@orbita/core/controle/parar", () => ({ pararTudo, pararPorFrase }));
vi.mock("@orbita/core/controle/estado", () => ({ estadoDasMaos: async () => ({ maos: { ligado: false, detalhe: "não instalado" }, extensao: { ligado: false } }), blocosRegistrados: () => [] }));
vi.mock("@orbita/core/controle/espelho", () => ({ espelhosRegistrados: () => [] }));
const listarPassosDaTela = vi.fn(async (..._a: unknown[]) => [{ id: "p1", tool: "computador_agir", acao: "clicar", alvo: {}, risco: "escrita", decisao: "executado", resultado: "ok", duracaoMs: 12, temMiniatura: true, canal: "tela", criadoEm: new Date() }]);
const MINI = `data:image/jpeg;base64,${Buffer.from("jpeg-de-mentira").toString("base64")}`;
const miniaturaDoPasso = vi.fn(async (u: string, id: string) => (u === "u1" && id === "33333333-3333-4333-8333-333333333333" ? MINI : null));
vi.mock("@orbita/core/controle/trilha", () => ({ listarPassosDaTela, miniaturaDoPasso }));
const DO_DONO = "11111111-1111-4111-8111-111111111111";
vi.mock("@orbita/core/controle/sessao", () => ({ listarSessoes: async () => [], sessaoPorId: async (_u: string, id: string) => (id === DO_DONO ? { id } : null) }));
let aberta: { status: string } | null = null;
vi.mock("@orbita/core/controle/resumo", () => ({ resumoDoControle: async () => aberta }));
vi.mock("@orbita/core/owner", () => ({ isOwner: async () => true }));
vi.mock("@orbita/core/settings/index", () => ({ settings: { getMany: async () => ({ "controle.ativo": false, "controle.canais": ["tela"], "controle.telaAtualizarSeg": 3 }) } }));

const rota = await import("./controle");
const ctx = { params: {}, user: { id: "u1", email: "d@x", name: "Dono" } };
const anonimo = { params: {}, user: null } as never;
const req = (url: string, method = "GET", body?: unknown) => new Request(`http://x${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  aberta = null;
});

describe("/api/controle", () => {
  it("sem sessão: 401 em todas", async () => {
    expect((await rota.GET_ESTADO(req("/api/controle/estado"), anonimo)).status).toBe(401);
    expect((await rota.GET_PASSOS(req("/api/controle/passos?sessao=avulsos"), anonimo)).status).toBe(401);
    expect((await rota.POST_PARAR(req("/api/controle/parar", "POST"), anonimo)).status).toBe(401);
    expect((await rota.POST_FALADA(req("/api/controle/falada", "POST", { texto: "para" }), anonimo)).status).toBe(401);
    expect(pararTudo).not.toHaveBeenCalled();
  });

  it("estado: mãos desligadas por padrão; a tela só volta a perguntar com sessão ativa", async () => {
    const d = await (await rota.GET_ESTADO(req("/api/controle/estado"), ctx)).json();
    expect(d).toMatchObject({ ativo: false, maos: { ligado: false }, extensao: { ligado: false }, blocos: [], atualizarEmSeg: null });
    aberta = { status: "ativa" };
    expect((await (await rota.GET_ESTADO(req("/api/controle/estado"), ctx)).json()).atualizarEmSeg).toBe(3);
  });

  it("trilha: sessão de outra pessoa é 404, entrada torta é 400, avulsos vale", async () => {
    expect((await rota.GET_PASSOS(req("/api/controle/passos?sessao=22222222-2222-4222-8222-222222222222"), ctx)).status).toBe(404);
    expect((await rota.GET_PASSOS(req("/api/controle/passos?sessao=xyz"), ctx)).status).toBe(400);
    expect((await rota.GET_PASSOS(req(`/api/controle/passos?sessao=${DO_DONO}`), ctx)).status).toBe(200);
    expect(listarPassosDaTela).toHaveBeenLastCalledWith("u1", DO_DONO, 200);
    await rota.GET_PASSOS(req("/api/controle/passos?sessao=avulsos"), ctx);
    expect(listarPassosDaTela).toHaveBeenLastCalledWith("u1", null, 200);
  });

  it("trilha sem as miniaturas (M10): a lista diz se há uma, e cada uma vem pela sua rota, só do dono", async () => {
    const d = await (await rota.GET_PASSOS(req("/api/controle/passos?sessao=avulsos"), ctx)).json();
    expect(d.passos[0]).toMatchObject({ id: "p1", temMiniatura: true });
    expect(d.passos[0]).not.toHaveProperty("miniatura");
    const img = await rota.GET_MINIATURA(req("/api/controle/passos/33333333-3333-4333-8333-333333333333/miniatura"), { ...ctx, params: { id: "33333333-3333-4333-8333-333333333333" } });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await img.arrayBuffer()).toString()).toBe("jpeg-de-mentira");
    expect((await rota.GET_MINIATURA(req("/x"), { ...ctx, params: { id: "44444444-4444-4444-8444-444444444444" } })).status).toBe(404);
    expect((await rota.GET_MINIATURA(req("/x"), { ...ctx, params: { id: "nao-e-uuid" } })).status).toBe(400);
    expect((await rota.GET_MINIATURA(req("/x"), { params: { id: "33333333-3333-4333-8333-333333333333" }, user: null } as never)).status).toBe(401);
  });

  it("parar: delega ao core com a origem 'tela'", async () => {
    const r = await rota.POST_PARAR(req("/api/controle/parar", "POST"), ctx);
    expect(await r.json()).toMatchObject({ ok: true, sessoes: 1, propostas: 2 });
    expect(pararTudo).toHaveBeenCalledWith("u1", "tela");
  });

  it("fala na voz: o core decide; texto vazio é 400", async () => {
    expect(await (await rota.POST_FALADA(req("/api/controle/falada", "POST", { texto: "para" }), ctx)).json()).toEqual({ tratado: true, resposta: "Parei." });
    expect(await (await rota.POST_FALADA(req("/api/controle/falada", "POST", { texto: "manda para o João" }), ctx)).json()).toEqual({ tratado: false, resposta: null });
    expect(pararPorFrase).toHaveBeenCalledWith("u1", "voz", "para");
    expect((await rota.POST_FALADA(req("/api/controle/falada", "POST", { texto: "" }), ctx)).status).toBe(400);
  });
});
