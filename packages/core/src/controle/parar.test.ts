import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * PARAR (PRD F6) e o espelho das mãos. Travado aqui: a frase só vale inteira
 * ("manda para o João" não para nada); parar avisa as mãos, para as sessões,
 * cancela as propostas do controle na fila e emite `controle.parado`; o
 * espelho isola o ouvinte que falha ou demora; o estado das mãos sem
 * provedor é "desligado".
 */

const cfg: Record<string, unknown> = { "controle.espelhoTimeoutMs": 50, "controle.frasesParar": ["para", "pare", "parar", "para tudo", "chega"] };
vi.mock("../settings", () => ({ settings: { get: async (k: string) => cfg[k] } }));
const emit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../events/index", () => ({ events: { emit } }));

let abertas: { id: string }[] = [];
// trabalhos do PC em segundo plano (o comando de terminal avulso que passou do tempo de espera)
let trabalhos: { id: string }[] = [];
const { job: tabelaDeTrabalhos } = await import("@orbita/db/job-schema");
const cancelJob = vi.fn(async (..._a: unknown[]) => ({ id: "j1" }));
vi.mock("../jobs/queue", () => ({ cancelJob: (...a: unknown[]) => cancelJob(...a) }));
const canceladas: unknown[] = [];
vi.mock("@orbita/db", () => ({
  db: {
    select: () => ({ from: (t: unknown) => ({ where: async () => (t === tabelaDeTrabalhos ? trabalhos : abertas) }) }),
    update: () => ({ set: (v: unknown) => ({ where: () => ({ returning: async () => (canceladas.push(v), [{ id: "q1" }, { id: "q2" }]) }) }) }),
  },
}));
let sessaoAberta: { id: string } | null = null;
const terminarSessao = vi.fn(async (_u: string, id: string) => ({ id }));
vi.mock("./sessao", () => ({ EVENTO: { parado: "controle.parado" }, sessaoAtual: async () => sessaoAberta, terminarSessao: (...a: [string, string]) => terminarSessao(...a) }));

const { registerTools, _resetRegistry } = await import("../tools/registry");
const { ehFraseDeParar, pararPorFrase, pararTudo } = await import("./parar");
const { registrarEspelho, espelhar, _limparEspelhos, espelhosRegistrados } = await import("./espelho");
const { estadoDasMaos, registrarEstadoDasMaos, registrarEstadoDaExtensao, registrarBloco, blocosRegistrados, _limparEstado } = await import("./estado");

beforeEach(() => {
  vi.clearAllMocks();
  _limparEspelhos();
  _limparEstado();
  _resetRegistry();
  abertas = [];
  trabalhos = [];
  canceladas.length = 0;
  sessaoAberta = null;
});

describe("frase de parar", () => {
  const frases = cfg["controle.frasesParar"] as string[];
  it.each([
    ["para", true],
    ["Para!", true],
    ["PARE.", true],
    ["Órbita, para", true],
    ["para, para, para", true],
    ["para tudo", true],
    ["ei órbita para", true],
    ["chega", true],
    ["manda para o João", false],
    ["para onde vai o ônibus?", false],
    ["parabéns", false],
    ["", false],
  ])("%s → %s", (fala, esperado) => {
    expect(ehFraseDeParar(fala as string, frases)).toBe(esperado);
  });
});

describe("parar tudo", () => {
  it("avisa as mãos, para as sessões, cancela as propostas do controle e emite o evento", async () => {
    registerTools([
      { name: "terminal_rodar", domain: "terminal", description: "x", risk: "leitura", inputSchema: z.object({}), run: async () => null },
      { name: "enviar_email_x", domain: "gmail", description: "x", risk: "efeito_externo", inputSchema: z.object({}), run: async () => null },
    ]);
    const recebidos: unknown[] = [];
    registrarEspelho({ nome: "maos", notificar: async (e) => void recebidos.push(e) });
    abertas = [{ id: "s1" }, { id: "s2" }];
    const r = await pararTudo("u1", "tela");
    expect(recebidos).toEqual([{ tipo: "parar", userId: "u1", origem: "tela" }]);
    expect(terminarSessao.mock.calls.map((c) => c[1])).toEqual(["s1", "s2"]);
    expect(r).toMatchObject({ sessoes: 2, propostas: 2, maos: [{ nome: "maos", ok: true }] });
    expect(canceladas).toEqual([{ status: "cancelled", result: "cancelada: o dono mandou parar" }]);
    expect(emit).toHaveBeenCalledWith("controle.parado", { origem: "tela", sessoes: 2, propostas: 2 }, { userId: "u1" });
  });

  it("pela frase: só com sessão aberta (sem sessão, 'para' é conversa)", async () => {
    expect(await pararPorFrase("u1", "voz", "para")).toBeNull();
    sessaoAberta = { id: "s1" };
    abertas = [{ id: "s1" }];
    expect(await pararPorFrase("u1", "voz", "manda para o João")).toBeNull();
    const r = await pararPorFrase("u1", "whatsapp", "Para!");
    expect(r?.estado).toBe("parado");
    expect(r?.texto).toMatch(/^Parei\./);
  });

  it("sem sessão, mas com comando do terminal rodando em segundo plano: 'para' pela voz para ele também (M15)", async () => {
    trabalhos = [{ id: "j1" }];
    const r = await pararPorFrase("u1", "voz", "para");
    expect(r?.estado).toBe("parado");
    expect(r?.texto).toMatch(/rodando no computador/);
    expect(cancelJob).toHaveBeenCalledWith("u1", "j1");
    // as mãos recebem o "parar", que mata a árvore do comando (Job Object)
    expect(emit).toHaveBeenCalledWith("controle.parado", expect.objectContaining({ origem: "voz" }), { userId: "u1" });
  });

  it("controle: sem sessão e sem nada rodando, 'para' continua sendo conversa", async () => {
    expect(await pararPorFrase("u1", "voz", "para")).toBeNull();
    expect(cancelJob).not.toHaveBeenCalled();
  });

  it("mão que não confirma aparece na resposta, e não segura o parar", async () => {
    sessaoAberta = { id: "s1" };
    registrarEspelho({ nome: "extensao", notificar: () => new Promise(() => undefined) });
    const r = await pararPorFrase("u1", "voz", "pare");
    expect(r?.texto).toContain("Não consegui confirmar com extensao");
  });
});

describe("espelho do envelope", () => {
  it("ouvinte que lança não impede os outros; registrar de novo pelo nome troca", async () => {
    const ok = vi.fn(async () => undefined);
    registrarEspelho({ nome: "a", notificar: async () => Promise.reject(new Error("caiu")) });
    const tirar = registrarEspelho({ nome: "b", notificar: ok });
    const r = await espelhar({ tipo: "fim", userId: "u1", sessaoId: "s1", status: "encerrada", motivo: "x" }, 50);
    expect(r).toEqual([{ nome: "a", ok: false, erro: "caiu" }, { nome: "b", ok: true }]);
    expect(ok).toHaveBeenCalledTimes(1);
    tirar();
    expect(espelhosRegistrados()).toEqual(["a"]);
  });
});

describe("estado das mãos", () => {
  it("sem provedor é desligado, com o motivo; com provedor, o que ele disser; falha vira desligado", async () => {
    expect(await estadoDasMaos()).toMatchObject({ maos: { ligado: false }, extensao: { ligado: false } });
    registrarEstadoDasMaos({ estado: () => ({ ligado: true, versao: "0.1.0", detalhe: "2 monitores" }) });
    registrarEstadoDaExtensao({ estado: async () => Promise.reject(new Error("ws")) });
    const e = await estadoDasMaos();
    expect(e.maos).toEqual({ ligado: true, versao: "0.1.0", detalhe: "2 monitores", vistoEm: null });
    expect(e.extensao.ligado).toBe(false);
  });
  it("bloco da tela só aparece quando a frente o registra", () => {
    expect(blocosRegistrados()).toEqual([]);
    registrarBloco("sites");
    registrarBloco("pareamento");
    expect(blocosRegistrados()).toEqual(["pareamento", "sites"]);
  });
});
