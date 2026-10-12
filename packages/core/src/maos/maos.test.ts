import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O CLIENTE e o SERVIÇO das mãos do Windows (PRD A1, F2, F6) com o `fetch`
 * mockado: só loopback, token em todo pedido, recusa das mãos virando
 * `recusada`, o espelho do envelope, o aviso de "o dono apertou o atalho" e a
 * volta do laço `maos` (config empurrada pelo hash, avisos confirmados).
 */

const cfg: Record<string, unknown> = {};
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../settings/defs")>("../settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});
vi.mock("../owner", () => ({ getOwnerId: async () => "dono" }));
const parados: string[] = [];
vi.mock("../controle/parar", () => ({ pararTudo: async (_u: string, origem: string) => void parados.push(origem) }));
const pausas: { sessao: string; motivo: string }[] = [];
let sessaoAtiva: { id: string } | null = { id: "s1" };
vi.mock("../controle/sessao", () => ({
  sessaoAtual: async () => sessaoAtiva,
  pausarSessao: async (_u: string, sessao: string, motivo: string) => void pausas.push({ sessao, motivo }),
}));

const cliente = await import("./client");
const servico = await import("./servico");

type Pedido = { url: string; metodo: string; corpo: unknown; token: string | null };
const pedidos: Pedido[] = [];
let responder: (p: Pedido) => { status: number; corpo: unknown } = () => ({ status: 200, corpo: { ok: true } });

const saude = (p: Partial<import("./client").SaudeDasMaos> = {}): import("./client").SaudeDasMaos => ({
  status: "ok", versao: "0.1.0", maquina: "pc", sessao_windows: 1, integridade: "media", elevado: false, dpi: { por_monitor_v2: true },
  monitores: [{ indice: 0, x: 0, y: 0, largura: 1920, altura: 1080, dpi: 96, escala: 1, primario: true, nome: "\\\\.\\DISPLAY1" }],
  shells: { powershell: "powershell.exe" }, isolamento: { sandbox: false, docker: true }, espelho: { status: "livre", sessaoId: null, motivo: null },
  atalho: { texto: "Ctrl+Alt+Esc", registrado: true, erro: null }, bandeja: { erro: null }, avisos: [], terminal: { rodando: 0, sessoes: 0 }, ultimo_parar: null,
  config_hash: "", ...p,
});

beforeEach(() => {
  pedidos.length = 0;
  parados.length = 0;
  pausas.length = 0;
  sessaoAtiva = { id: "s1" };
  for (const k of Object.keys(cfg)) delete cfg[k];
  process.env.MAOS_TOKEN = "token-de-teste";
  servico._reiniciarServico();
  cliente._definirSaude(null);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    const p = { url, metodo: init.method ?? "GET", corpo: init.body ? JSON.parse(String(init.body)) : undefined, token: h.get("x-orbita-maos") };
    pedidos.push(p);
    const r = responder(p);
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  responder = () => ({ status: 200, corpo: { ok: true } });
});

describe("cliente das mãos", () => {
  it("só loopback: a LAN e outro host não servem", () => {
    expect(cliente.ehLoopback("http://127.0.0.1:8003")).toBe(true);
    expect(cliente.ehLoopback("http://localhost:8003")).toBe(true);
    expect(cliente.ehLoopback("http://192.168.0.10:8003")).toBe(false);
    expect(cliente.ehLoopback("http://maos.evil.example:8003")).toBe(false);
  });

  it("recusa falar com endereço que não é desta máquina, sem mandar o token", async () => {
    cfg["maos.url"] = "http://192.168.0.10:8003";
    await expect(cliente.chamarMaos("/health")).rejects.toMatchObject({ status: 400 });
    expect(pedidos).toHaveLength(0);
  });

  it("sem MAOS_TOKEN não pede nada", async () => {
    delete process.env.MAOS_TOKEN;
    await expect(cliente.chamarMaos("/health")).rejects.toThrow(/MAOS_TOKEN/);
    expect(pedidos).toHaveLength(0);
  });

  it("todo pedido leva o token", async () => {
    await cliente.chamarMaos("/sistema");
    expect(pedidos[0]).toMatchObject({ url: "http://127.0.0.1:8003/sistema", token: "token-de-teste" });
  });

  it("409 das mãos é recusa com o motivo, para o modelo repassar", async () => {
    responder = () => ({ status: 409, corpo: { detail: "A tela mudou: veja de novo.", recusada: true } });
    await expect(cliente.chamarMaos("/computador/agir", { corpo: {} })).rejects.toMatchObject({ recusada: true, message: "A tela mudou: veja de novo." });
  });

  it("o token confere em tempo constante e nunca sem token configurado", () => {
    expect(cliente.tokenConfere("token-de-teste")).toBe(true);
    expect(cliente.tokenConfere("outro")).toBe(false);
    delete process.env.MAOS_TOKEN;
    expect(cliente.tokenConfere("")).toBe(false);
  });

  it("disponível só com /health recente e não elevado", async () => {
    responder = () => ({ status: 200, corpo: saude() });
    await cliente.atualizarSaude();
    expect(cliente.maosDisponivel()).toBe(true);
    expect(cliente.maosDisponivel(Date.now() + 121_000)).toBe(false);
    responder = () => ({ status: 200, corpo: saude({ elevado: true }) });
    await cliente.atualizarSaude();
    expect(cliente.maosDisponivel()).toBe(false);
    expect(cliente.estadoParaOHealth()).toBe("mal_configurado");
  });

  it("estado para o /api/health", async () => {
    delete process.env.MAOS_TOKEN;
    expect(cliente.estadoParaOHealth()).toBe("mal_configurado");
    process.env.MAOS_TOKEN = "t";
    expect(cliente.estadoParaOHealth()).toBe("down");
    responder = () => ({ status: 200, corpo: saude() });
    await cliente.atualizarSaude();
    expect(cliente.estadoParaOHealth()).toBe("up");
    responder = () => ({ status: 401, corpo: { detail: "não autorizado" } });
    await cliente.atualizarSaude();
    expect(cliente.estadoParaOHealth()).toBe("mal_configurado");
  });

  it("o hash da config é o mesmo que o apps/maos calcula", () => {
    const py = createHash("sha1").update("Ctrl+Alt+Esc|KeePass|1Password").digest("hex").slice(0, 12);
    expect(cliente.hashDaConfig("Ctrl+Alt+Esc", ["KeePass", "1Password"])).toBe(py);
  });
});

describe("espelho do envelope para as mãos", () => {
  const env = { sessaoId: "s1", alvo: "computador" as const, objetivo: "o", apps: ["notepad"], sites: [], tetoPassos: 5, passosUsados: 0, expiraEm: new Date().toISOString(), maquina: "pc" };

  it("envelope do computador vai em PUT /envelope; só do Chrome não vai", async () => {
    await servico.espelhoDasMaos.notificar({ tipo: "envelope", userId: "u", envelope: env });
    expect(pedidos[0]).toMatchObject({ url: "http://127.0.0.1:8003/envelope", metodo: "PUT", corpo: { sessaoId: "s1" } });
    await servico.espelhoDasMaos.notificar({ tipo: "envelope", userId: "u", envelope: { ...env, alvo: "navegador" } });
    expect(pedidos).toHaveLength(1);
  });

  it("fim e parar", async () => {
    await servico.espelhoDasMaos.notificar({ tipo: "fim", userId: "u", sessaoId: "s1", status: "parada", motivo: "x" });
    await servico.espelhoDasMaos.notificar({ tipo: "parar", userId: "u", origem: "botao" });
    expect(pedidos.map((p) => p.url.replace("http://127.0.0.1:8003", ""))).toEqual(["/envelope/fim", "/parar"]);
  });

  it("sem token não há a quem avisar, e isso não é erro", async () => {
    delete process.env.MAOS_TOKEN;
    await servico.espelhoDasMaos.notificar({ tipo: "parar", userId: "u", origem: "botao" });
    expect(pedidos).toHaveLength(0);
  });
});

describe("avisos das mãos", () => {
  it("o atalho de parar vira pararTudo no core, uma vez só por id", async () => {
    expect(await servico.tratarAvisoDasMaos({ id: "a1", tipo: "parar", origem: "atalho" })).toEqual({ tratado: true });
    expect(await servico.tratarAvisoDasMaos({ id: "a1", tipo: "parar", origem: "atalho" })).toMatchObject({ tratado: false });
    expect(parados).toEqual(["maos:atalho"]);
  });

  it("o dono mexeu no mouse: pausa a sessão do aviso, e não outra", async () => {
    await servico.tratarAvisoDasMaos({ id: "b1", tipo: "pausar", origem: "mouse", motivo: "o dono clicou", sessaoId: "s1" });
    expect(pausas).toEqual([{ sessao: "s1", motivo: "o dono clicou" }]);
    expect(await servico.tratarAvisoDasMaos({ id: "b2", tipo: "pausar", origem: "mouse", sessaoId: "velha" })).toMatchObject({ tratado: false });
  });

  it("a volta do laço empurra a config quando o hash difere e confirma os avisos pendentes", async () => {
    cfg["computador.appsOcultos"] = ["KeePass"];
    responder = (p) => (p.url.endsWith("/health") ? { status: 200, corpo: saude({ config_hash: "velho", avisos: [{ id: "c1", tipo: "parar", origem: "atalho" }] }) } : { status: 200, corpo: { ok: true } });
    await servico.voltaDoLacoMaos();
    const caminhos = pedidos.map((p) => `${p.metodo} ${p.url.replace("http://127.0.0.1:8003", "")}`);
    expect(caminhos).toEqual(["GET /health", "PUT /config", "POST /avisos/confirmar"]);
    expect(pedidos[1]!.corpo).toMatchObject({ appsOcultos: ["KeePass"] });
    expect(pedidos[2]!.corpo).toEqual({ ids: ["c1"] });
    expect(parados).toEqual(["maos:atalho"]);
  });

  it("com a config em dia, não empurra nada", async () => {
    const hash = cliente.hashDaConfig("Ctrl+Alt+Esc", (await import("../settings/defs")).SETTING_DEFS["computador.appsOcultos"].default);
    responder = () => ({ status: 200, corpo: saude({ config_hash: hash }) });
    await servico.voltaDoLacoMaos();
    expect(pedidos.map((p) => p.url.replace("http://127.0.0.1:8003", ""))).toEqual(["/health"]);
  });

  it("estado para a tela diz por que está desligado", async () => {
    delete process.env.MAOS_TOKEN;
    expect(servico.estadoDasMaosAgora()).toMatchObject({ ligado: false });
    expect(servico.estadoDasMaosAgora().detalhe).toContain("MAOS_TOKEN");
    process.env.MAOS_TOKEN = "t";
    responder = () => ({ status: 200, corpo: saude() });
    await cliente.atualizarSaude();
    expect(servico.estadoDasMaosAgora()).toMatchObject({ ligado: true, versao: "0.1.0" });
  });
});
