import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O trabalho da tarefa delegada no Windows: uma tentativa só, config lida por
 * rodada (sem restart), o "parar" cortando a chamada ao Claude em andamento e o
 * aviso ao dono no fim.
 */

const cfg: Record<string, unknown> = {};
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../settings/defs")>("../settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});

let statusDaSessao = "ativa";
const pausas: string[] = [];
vi.mock("../controle/sessao", () => ({
  sessaoPorId: async () => ({ id: "s1", status: statusDaSessao, apps: ["Bloco de Notas"] }),
  pausarSessao: async (_u: string, _s: string, m: string) => void pausas.push(m),
}));
const avisos: string[] = [];
vi.mock("../routines/run", () => ({ notifyUser: async (_u: string, t: string, x: string) => void avisos.push(`${t}: ${x}`) }));
vi.mock("../tools/index", () => ({ executarPeloRegistro: async () => ({}), buildToolSet: async () => ({}) }));
vi.mock("../llm/gerar", () => ({ gerarTexto: async () => ({ texto: "" }) }));
vi.mock("../usage/registrar", () => ({ FLUXO: { computador: "computador" }, registrarUso: vi.fn() }));
vi.mock("../navegador/trabalho", () => ({ esperarAprovacaoNaFila: vi.fn() }));
vi.mock("../jobs/registry", () => ({ registerJobs: vi.fn() }));
vi.mock("../jobs/queue", () => ({ JobPermanentError: class JobPermanentError extends Error {} }));
vi.mock("./servico", () => ({ janelasAbertas: async () => [{ janela: 5, titulo: "t", app: "Bloco de Notas", exe: "notepad.exe", nomes: ["notepad"], foco: true, minimizada: false, elevada: false, oculta: false }] }));
const rodar = vi.fn();
vi.mock("./motor", () => ({ rodarTarefa: (...a: unknown[]) => rodar(...a) }));

const { dependenciasDaTarefa, tarefaNoComputador } = await import("./trabalho");
const { decidirFalha } = await import("../jobs/policy");

const cancelado = vi.fn(async () => false);
const pedido = { userId: "u1", objetivo: "anotar", sessaoId: "s1", canal: "tela" as const, pedido: "anota", cancelado, progresso: async () => undefined };
const antesToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

beforeEach(() => {
  for (const k of Object.keys(cfg)) delete cfg[k];
  statusDaSessao = "ativa";
  pausas.length = 0;
  avisos.length = 0;
  rodar.mockReset();
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "tok";
});
afterEach(() => {
  if (antesToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  else process.env.CLAUDE_CODE_OAUTH_TOKEN = antesToken;
});

describe("o trabalho", () => {
  it("tem UMA tentativa: se o processo cai no meio, a recuperação desiste em vez de repetir cliques", () => {
    expect(tarefaNoComputador).toMatchObject({ kind: "computador.tarefa", maxAttempts: 1 });
    // a primeira (e única) tentativa já foi gasta quando o zumbi é achado
    expect(decidirFalha(1, tarefaNoComputador.maxAttempts!, false)).toBe("desistir");
  });

  it("sem objetivo ou sem sessão é erro permanente (não volta para a fila)", async () => {
    const ctx = { userId: "u1", payload: { objetivo: "", sessaoId: "s1" }, cancelado, progresso: async () => undefined };
    await expect(tarefaNoComputador.run(ctx as never)).rejects.toThrow(/sem objetivo ou sem sessão/);
    await expect(tarefaNoComputador.run({ ...ctx, payload: { objetivo: "x" } } as never)).rejects.toThrow(/sem objetivo ou sem sessão/);
  });

  it("roda o laço com o pedido do payload, avisa o dono no fim e limpa a sonda de parada", async () => {
    rodar.mockResolvedValue({ estado: "concluida", resumo: "Anotei.", tokens: 10, acoes: 2, motor: "claude" });
    const ctx = { userId: "u1", payload: { objetivo: "anotar: comprar leite", sessaoId: "s1", canal: "voz", pedido: "anota comprar leite" }, cancelado, progresso: async () => undefined };
    const r = await tarefaNoComputador.run(ctx as never);
    expect(r).toMatchObject({ estado: "concluida", resumo: "Anotei." });
    expect(rodar.mock.calls[0]![0]).toEqual({ objetivo: "anotar: comprar leite", pedido: "anota comprar leite" });
    expect(avisos).toEqual(["Terminei a tarefa no Windows: anotar: comprar leite\n\nAnotei."]);
  });

  it("parou no meio: o aviso diz que a tarefa parou, com o motivo", async () => {
    rodar.mockResolvedValue({ estado: "pausada", resumo: "Parei: o dono não aprovou.", tokens: 1, acoes: 0, motor: "claude" });
    await tarefaNoComputador.run({ userId: "u1", payload: { objetivo: "x", sessaoId: "s1" }, cancelado, progresso: async () => undefined } as never);
    expect(avisos[0]).toMatch(/^A tarefa no Windows parou: x\n\nParei: o dono não aprovou/);
  });

  it("o laço que lança ainda limpa a sonda (nenhum timer fica vivo)", async () => {
    rodar.mockRejectedValue(new Error("boom"));
    const limpar = vi.spyOn(globalThis, "clearInterval");
    await expect(tarefaNoComputador.run({ userId: "u1", payload: { objetivo: "x", sessaoId: "s1" }, cancelado, progresso: async () => undefined } as never)).rejects.toThrow("boom");
    expect(limpar).toHaveBeenCalled();
    limpar.mockRestore();
  });
});

describe("dependenciasDaTarefa", () => {
  it("lê as chaves da tela (computador.*) por rodada e as converte para o laço", async () => {
    cfg["computador.passosPorTarefa"] = 12;
    cfg["computador.esperaAprovacaoMin"] = 2;
    cfg["computador.travadoSeg"] = 9;
    cfg["computador.escalarParaOpus"] = true;
    const { cfg: c, encerrar } = await dependenciasDaTarefa(pedido);
    encerrar();
    expect(c).toMatchObject({ modelo: "claude/claude-sonnet-5-5", usarClaude: true, passosMax: 12, capturas: 3, contextoMaxTokens: 150000, esperaAprovacaoMs: 120_000, travadoMs: 9000, pausaMaxMs: 30000, escalarParaOpus: true, apps: ["Bloco de Notas"] });
  });

  it("computador.motor = orbita ou sem token usa a reserva", async () => {
    cfg["computador.motor"] = "orbita";
    const a = await dependenciasDaTarefa(pedido);
    a.encerrar();
    expect(a.cfg.usarClaude).toBe(false);
    cfg["computador.motor"] = "claude";
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const b = await dependenciasDaTarefa(pedido);
    b.encerrar();
    expect(b.cfg.usarClaude).toBe(false);
  });

  it("com o screenshot na nuvem desligado (controle.capturaParaNuvem), a tarefa NÃO usa o Claude: vai para a árvore e o modelo da casa", async () => {
    cfg["controle.capturaParaNuvem"] = false;
    const a = await dependenciasDaTarefa(pedido);
    a.encerrar();
    expect(a.cfg.usarClaude).toBe(false);
    cfg["controle.capturaParaNuvem"] = true;
    const b = await dependenciasDaTarefa(pedido);
    b.encerrar();
    expect(b.cfg.usarClaude).toBe(true);
  });

  it("o parar da sessão corta a chamada ao Claude em andamento em poucas centenas de ms", async () => {
    const { deps, encerrar } = await dependenciasDaTarefa(pedido);
    expect(deps.sinal!.aborted).toBe(false);
    const t0 = Date.now();
    statusDaSessao = "parada";
    await new Promise<void>((r) => deps.sinal!.addEventListener("abort", () => r(), { once: true }));
    encerrar();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(await deps.estadoDaSessao()).toBe("parada");
  });

  it("cancelar o trabalho também corta", async () => {
    cancelado.mockResolvedValueOnce(true);
    const { deps, encerrar } = await dependenciasDaTarefa(pedido);
    await new Promise<void>((r) => deps.sinal!.addEventListener("abort", () => r(), { once: true }));
    encerrar();
    expect(deps.sinal!.aborted).toBe(true);
  });

  it("pausar a sessão usa o caminho existente, e as janelas vêm só como leitura", async () => {
    const { deps, encerrar } = await dependenciasDaTarefa(pedido);
    await deps.pausarSessao("teto de ações da tarefa");
    expect(pausas).toEqual(["teto de ações da tarefa"]);
    expect(await deps.janelas()).toEqual([{ janela: 5, app: "Bloco de Notas", nomes: ["notepad"], foco: true, minimizada: false, elevada: false, oculta: false }]);
    encerrar();
  });
});
