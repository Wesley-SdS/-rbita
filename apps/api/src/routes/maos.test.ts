import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rotas das mãos do Windows (PRD A1, F6, F7). Travado: o aviso das mãos só
 * entra com o MAOS_TOKEN e sem Origin (página web nenhuma o forja, nem com o
 * token roubado); as telas são só do dono; classificar não roda nada.
 */

const tratarAvisoDasMaos = vi.fn(async (..._a: unknown[]) => ({ tratado: true }));
vi.mock("@orbita/core/maos/servico", () => ({ tratarAvisoDasMaos }));
const classificarParaATela = vi.fn(async (comando: string) => ({ risco: comando === "git status" ? "leitura" : "efeito_externo", motivos: [], shell: "powershell", pasta: "c:\\x" }));
vi.mock("@orbita/core/maos/tela", () => ({ pastasParaATela: async () => ({ terminal: [], arquivos: [], shells: [], maosLigadas: false }), appsAbertosParaATela: async () => ({ apps: [], ocultos: [], maosLigadas: false }), comandosParaATela: async () => ({ comandos: ["git status"], shellPadrao: "pwsh", shells: [] }), classificarParaATela }));
let dono = true;
vi.mock("@orbita/core/owner", () => ({ isOwner: async () => dono }));

const rota = await import("./maos");
const ctx = { params: {}, user: { id: "u1", email: "d@x", name: "Dono" } };
const anonimo = { params: {}, user: null } as never;
const aviso = { id: "aviso-0001", tipo: "parar", origem: "atalho" };
const post = (corpo: unknown, h: Record<string, string> = {}) => new Request("http://127.0.0.1:3010/api/maos/aviso", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(corpo) });

beforeEach(() => {
  vi.clearAllMocks();
  dono = true;
  process.env.MAOS_TOKEN = "token-das-maos";
});

describe("POST /api/maos/aviso", () => {
  it("sem token, ou com token errado: 401, e nada para", async () => {
    expect((await rota.POST_AVISO(post(aviso), anonimo)).status).toBe(401);
    expect((await rota.POST_AVISO(post(aviso, { "x-orbita-maos": "outro" }), anonimo)).status).toBe(401);
    expect(tratarAvisoDasMaos).not.toHaveBeenCalled();
  });

  it("com Origin: 403 mesmo com o token certo", async () => {
    expect((await rota.POST_AVISO(post(aviso, { "x-orbita-maos": "token-das-maos", origin: "https://evil.example" }), anonimo)).status).toBe(403);
    expect(tratarAvisoDasMaos).not.toHaveBeenCalled();
  });

  it("sem MAOS_TOKEN configurado, nenhum token vale", async () => {
    delete process.env.MAOS_TOKEN;
    expect((await rota.POST_AVISO(post(aviso, { "x-orbita-maos": "" }), anonimo)).status).toBe(401);
  });

  it("com o token e o corpo certo: trata o aviso (sem sessão de usuário)", async () => {
    const r = await rota.POST_AVISO(post(aviso, { "x-orbita-maos": "token-das-maos" }), anonimo);
    expect(r.status).toBe(200);
    expect(tratarAvisoDasMaos).toHaveBeenCalledWith(expect.objectContaining({ tipo: "parar", origem: "atalho" }));
  });

  it("aviso torto: 400", async () => {
    expect((await rota.POST_AVISO(post({ id: "x", tipo: "explodir" }, { "x-orbita-maos": "token-das-maos" }), anonimo)).status).toBe(400);
  });
});

describe("telas das mãos", () => {
  it("só o dono", async () => {
    expect((await rota.GET_PASTAS(new Request("http://x"), anonimo)).status).toBe(401);
    dono = false;
    expect((await rota.GET_APPS(new Request("http://x"), ctx)).status).toBe(403);
    expect((await rota.POST_CLASSIFICAR(new Request("http://x", { method: "POST", body: JSON.stringify({ comando: "ls" }) }), ctx)).status).toBe(403);
  });

  it("classificar devolve o risco sem rodar", async () => {
    const r = await rota.POST_CLASSIFICAR(new Request("http://x", { method: "POST", body: JSON.stringify({ comando: "git status" }) }), ctx);
    expect(await r.json()).toMatchObject({ risco: "leitura" });
    expect((await rota.POST_CLASSIFICAR(new Request("http://x", { method: "POST", body: JSON.stringify({ comando: "" }) }), ctx)).status).toBe(400);
  });
});
