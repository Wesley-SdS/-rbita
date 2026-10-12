import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolDef } from "../tools/registry";

/**
 * A guarda das tools sensíveis (PRD F1 a F4), com banco e modelo simulados.
 * O que fica travado: controle desligado e quem não é dono não agem; escrita de
 * computador sem sessão não age; o crítico veta e dois vetos pausam e avisam;
 * o teto de passos pausa; o passo é gravado ANTES e atualizado depois; a ação
 * aprovada na fila continua o passo que esperava e não passa pelo crítico.
 */

const cfg: Record<string, unknown> = { "controle.ativo": true, "controle.guardarMiniaturas": false, "controle.criticoTextoMax": 200, "controle.vetosParaPausar": 2 };
vi.mock("../settings", () => ({ settings: { getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, cfg[k]])) } }));
let dono = true;
vi.mock("../owner", () => ({ isOwner: async () => dono }));
const notifyUser = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../routines/run", () => ({ notifyUser }));

type Sessao = { id: string; alvo: string; apps: string[]; sites: string[]; status: string; expiraEm: Date; passosUsados: number; tetoPassos: number; pedidoOriginal: string; pedidoLiteral: boolean; objetivo: string; vetosSeguidos: number };
let sessao: Sessao | null = null;
const pausarSessao = vi.fn(async (_u: string, _id: string, motivo: string) => {
  if (sessao) sessao = { ...sessao, status: "pausada" };
  return { motivo };
});
vi.mock("./sessao", () => ({
  sessaoParaTipo: async (_u: string, tipo: string) => (sessao && sessao.status === "ativa" && (sessao.alvo === tipo || sessao.alvo === "ambos") ? sessao : null),
  pausarSessao: (...a: [string, string, string]) => pausarSessao(...a),
  contarPasso: async () => {
    if (!sessao || sessao.passosUsados >= sessao.tetoPassos) return null;
    sessao = { ...sessao, passosUsados: sessao.passosUsados + 1 };
    return sessao;
  },
  registrarVeredito: async (_u: string, _id: string, alinhado: boolean) => {
    if (!sessao) return 0;
    sessao = { ...sessao, vetosSeguidos: alinhado ? 0 : sessao.vetosSeguidos + 1 };
    return sessao.vetosSeguidos;
  },
}));

type Passo = { id: string; decisao: string; tool: string; acaoId?: string | null; sessaoId?: string | null; resultado?: string | null };
let passos: Passo[] = [];
vi.mock("./trilha", async () => {
  const real = await vi.importActual<typeof import("./trilha")>("./trilha");
  return {
    resumoDoResultado: real.resumoDoResultado,
    miniaturaDaSaida: real.miniaturaDaSaida,
    registrarPasso: async (p: Passo & { userId: string }) => {
      const id = `p${passos.length + 1}`;
      passos.push({ id, decisao: p.decisao, tool: p.tool, acaoId: p.acaoId ?? null, sessaoId: p.sessaoId ?? null, resultado: p.resultado ?? null });
      return id;
    },
    atualizarPasso: async (id: string, p: Partial<Passo>) => {
      passos = passos.map((x) => (x.id === id ? { ...x, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } : x));
    },
    passoDaProposta: async (_u: string, acaoId: string) => passos.find((x) => x.acaoId === acaoId && x.decisao === "na_fila") ?? null,
  };
});

// o modo de cada site (PRD B2): "escrita" libera agir fora do envelope, como o risco do navegador já decide
let sitesDeEscrita: string[] = [];
vi.mock("../navegador/sites", () => ({
  regrasDeSite: async () => ({}),
  decidirSite: (url: string) => ({ modo: sitesDeEscrita.some((d) => new URL(url).hostname.endsWith(d)) ? "escrita" : "leitura", fonte: "lista", explicito: true }),
}));

const { criarGuarda } = await import("./guarda");
const { registerTools, getTool, executarChamada, _resetRegistry } = await import("../tools/registry");

const agir: ToolDef<z.ZodObject<{ acao: z.ZodString; app: z.ZodString }>> = {
  name: "computador_agir", domain: "computador", description: "Age.", risk: "escrita",
  inputSchema: z.object({ acao: z.string(), app: z.string() }),
  run: async () => ({ mensagem: "cliquei" }),
};
const ctx = { userId: "u1", canal: "tela" as const };
const sessaoAtiva = (x: Partial<Sessao> = {}): Sessao => ({
  id: "s1", alvo: "computador", apps: ["VS Code"], sites: [], status: "ativa", expiraEm: new Date(Date.now() + 600_000), passosUsados: 0, tetoPassos: 5,
  pedidoOriginal: "roda os testes no VS Code", pedidoLiteral: true, objetivo: "rodar os testes", vetosSeguidos: 0, ...x,
});

beforeEach(() => {
  vi.clearAllMocks();
  cfg["controle.ativo"] = true;
  dono = true;
  sessao = null;
  passos = [];
  sitesDeEscrita = [];
});

describe("guarda do controle do PC", () => {
  it("controle desligado: recusa, grava o passo recusado e não roda", async () => {
    cfg["controle.ativo"] = false;
    const run = vi.fn();
    const g = criarGuarda(vi.fn());
    expect(await g.executar({ def: agir, entrada: { acao: "clicar", app: "VS Code" }, risco: "escrita", ctx, run })).toMatchObject({ permitido: false });
    expect(run).not.toHaveBeenCalled();
    expect(passos).toMatchObject([{ decisao: "recusado" }]);
  });

  it("conta que não é a dona da instância não age", async () => {
    dono = false;
    const run = vi.fn();
    expect(await criarGuarda(vi.fn()).executar({ def: agir, entrada: {}, risco: "escrita", ctx, run })).toMatchObject({ permitido: false });
    expect(run).not.toHaveBeenCalled();
  });

  it("escrita sem sessão é recusada com a frase de como abrir uma, mesmo se a tool esqueceu o authorize", async () => {
    const run = vi.fn();
    const r = await criarGuarda(vi.fn()).executar({ def: agir, entrada: { acao: "clicar", app: "VS Code" }, risco: "escrita", ctx, run });
    expect(r).toMatchObject({ permitido: false });
    expect((r as { erro: string }).erro).toMatch(/controle_iniciar/);
    expect(run).not.toHaveBeenCalled();
    expect(passos.at(-1)).toMatchObject({ decisao: "recusado" });
  });

  it("tool semSessao (mídia, volume) age sem sessão e sem crítico, mas com trilha", async () => {
    const gerar = vi.fn();
    const run = vi.fn(async () => ({ mensagem: "pausei a música" }));
    const r = await criarGuarda(gerar).executar({ def: { ...agir, name: "computador_midia", semSessao: true }, entrada: { acao: "pausar" }, risco: "escrita", ctx, run });
    expect(r).toEqual({ mensagem: "pausei a música" });
    expect(gerar).not.toHaveBeenCalled();
    expect(passos).toMatchObject([{ decisao: "executado", resultado: "pausei a música", tool: "computador_midia" }]);
  });

  it("alinhado: grava ANTES, conta o passo, roda e marca executado", async () => {
    sessao = sessaoAtiva();
    const gerar = vi.fn(async () => ({ alinhado: true, motivo: "ok" }));
    let gravadoAntes = false;
    const run = vi.fn(async () => {
      gravadoAntes = passos.some((p) => p.decisao === "executando");
      return { mensagem: "cliquei em Executar" };
    });
    await criarGuarda(gerar).executar({ def: agir, entrada: { acao: "clicar", app: "VS Code" }, risco: "escrita", ctx, run });
    expect(gravadoAntes).toBe(true);
    expect(passos).toMatchObject([{ decisao: "executado", sessaoId: "s1" }]);
    expect(sessao!.passosUsados).toBe(1);
    // o crítico leu o pedido do dono e os metadados, nada da tela
    expect((gerar.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt).toContain("roda os testes no VS Code");
  });

  it("vetado não roda; dois vetos seguidos pausam a sessão e avisam o dono", async () => {
    sessao = sessaoAtiva();
    const gerar = vi.fn(async () => ({ alinhado: false, motivo: "não tem a ver com os testes" }));
    const run = vi.fn();
    const g = criarGuarda(gerar);
    const r1 = await g.executar({ def: agir, entrada: { acao: "clicar", app: "VS Code" }, risco: "escrita", ctx, run });
    expect(r1).toMatchObject({ permitido: false, vetado: true, motivo: "não tem a ver com os testes" });
    expect(pausarSessao).not.toHaveBeenCalled();
    await g.executar({ def: agir, entrada: { acao: "clicar", app: "VS Code" }, risco: "escrita", ctx, run });
    expect(run).not.toHaveBeenCalled();
    expect(passos.map((p) => p.decisao)).toEqual(["vetado", "vetado"]);
    expect(pausarSessao).toHaveBeenCalledWith("u1", "s1", "2 vetos seguidos do crítico");
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(sessao!.passosUsados).toBe(0);
  });

  it("crítico fora do ar bloqueia sem contar como veto (não pausa por falha)", async () => {
    sessao = sessaoAtiva();
    const run = vi.fn();
    const g = criarGuarda(async () => {
      throw new Error("503");
    });
    for (let i = 0; i < 3; i++) await g.executar({ def: agir, entrada: { acao: "clicar", app: "VS Code" }, risco: "escrita", ctx, run });
    expect(run).not.toHaveBeenCalled();
    expect(pausarSessao).not.toHaveBeenCalled();
  });

  it("teto de passos: o passo que não cabe pausa a sessão e não roda", async () => {
    sessao = sessaoAtiva({ tetoPassos: 1 });
    const run = vi.fn(async () => "ok");
    const g = criarGuarda(async () => ({ alinhado: true, motivo: "" }));
    await g.executar({ def: agir, entrada: { acao: "clicar", app: "VS Code" }, risco: "escrita", ctx, run });
    const r = await g.executar({ def: agir, entrada: { acao: "clicar", app: "VS Code" }, risco: "escrita", ctx, run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ permitido: false });
    expect(pausarSessao).toHaveBeenCalledWith("u1", "s1", "teto de passos");
  });

  it("aprovada na fila: continua o passo que esperava, sem crítico, e falha vira 'falhou' com o erro relançado", async () => {
    sessao = sessaoAtiva();
    const gerar = vi.fn();
    const g = criarGuarda(gerar);
    await g.enfileirada({ def: agir, entrada: { acao: "clicar", app: "VS Code" }, risco: "efeito_externo", ctx, acaoId: "a1" });
    expect(passos).toMatchObject([{ decisao: "na_fila", acaoId: "a1", sessaoId: "s1" }]);
    await expect(g.executar({ def: agir, entrada: {}, risco: "efeito_externo", ctx: { userId: "u1" }, acaoId: "a1", run: async () => Promise.reject(new Error("a tela mudou")) })).rejects.toThrow("a tela mudou");
    expect(passos).toHaveLength(1);
    expect(passos[0]).toMatchObject({ decisao: "falhou", resultado: "a tela mudou" });
    expect(gerar).not.toHaveBeenCalled();
  });

  it("recusada grava o passo com o motivo e nunca lança", async () => {
    await criarGuarda(vi.fn()).recusada({ def: agir, entrada: {}, risco: "escrita", ctx, motivo: "Só o dono" });
    expect(passos).toMatchObject([{ decisao: "recusado", resultado: "Só o dono" }]);
  });
});

describe("rotina e regra nunca agem na tela nem no navegador (O3 da revisão)", () => {
  const navegar: ToolDef = { name: "navegador_qualquer", domain: "navegador", description: "x", risk: "escrita", inputSchema: z.object({}), run: async () => ({ mensagem: "agi" }) };
  const ler: ToolDef = { ...navegar, name: "navegador_ler_qualquer", risk: "leitura" };

  it.each([
    ["computador", agir],
    ["navegador", navegar],
  ] as const)("%s: escrita vinda de rotina ou regra é recusada mesmo DENTRO de uma sessão, sem o authorize da tool", async (_d, def) => {
    sessao = sessaoAtiva({ alvo: "ambos", sites: ["empresa.com"] });
    for (const origem of ["rotina", "regra"] as const) {
      const run = vi.fn();
      const r = await criarGuarda(vi.fn(async () => ({ alinhado: true, motivo: "ok" }))).executar({ def, entrada: { acao: "clicar", app: "VS Code" }, risco: "escrita", ctx: { ...ctx, origem }, run });
      expect(r).toMatchObject({ permitido: false, erro: expect.stringMatching(/Rotina e regra só leem/) });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("controle: ler na rotina passa, mídia sem sessão passa, e o dono na sessão continua agindo", async () => {
    sessao = sessaoAtiva({ alvo: "ambos", sites: ["empresa.com"] });
    const g = criarGuarda(vi.fn(async () => ({ alinhado: true, motivo: "ok" })));
    expect(await g.executar({ def: ler, entrada: {}, risco: "leitura", ctx: { ...ctx, origem: "rotina" }, run: async () => "li" })).toBe("li");
    expect(await g.executar({ def: { ...agir, name: "computador_midia", semSessao: true }, entrada: {}, risco: "escrita", ctx: { ...ctx, origem: "rotina" }, run: async () => "toquei" })).toBe("toquei");
    expect(await g.executar({ def: navegar, entrada: {}, risco: "escrita", ctx, run: async () => "agi" })).toBe("agi");
  });
});

describe("o backstop confere o app e o site do envelope, sem depender do authorize (I12)", () => {
  const alinhado = vi.fn(async () => ({ alinhado: true, motivo: "ok" }));
  // tools sintéticas que ESQUECERAM o authorize: só a guarda está entre elas e a tela
  const clicarSemAuthorize: ToolDef = { name: "computador_clicar_sintetica", domain: "computador", description: "x", risk: "escrita", inputSchema: z.object({ app: z.string() }), run: async () => ({ mensagem: "cliquei" }) };
  const navegarSemAuthorize: ToolDef = { name: "navegador_agir_sintetica", domain: "navegador", description: "x", risk: "escrita", inputSchema: z.object({ url: z.string() }), run: async () => ({ mensagem: "agi" }) };

  it("pelo registro: tool de computador sem authorize num app FORA do envelope é recusada e não roda; no envelope, roda", async () => {
    _resetRegistry();
    registerTools([clicarSemAuthorize]);
    sessao = sessaoAtiva({ apps: ["VS Code"] });
    const run = vi.spyOn(clicarSemAuthorize, "run");
    const opts = { enqueue: vi.fn(), guarda: criarGuarda(alinhado) };
    const fora = await executarChamada(getTool("computador_clicar_sintetica")!, { app: "Excel" }, ctx, opts as never);
    expect(fora).toMatchObject({ permitido: false, erro: expect.stringMatching(/"Excel" não está no envelope/) });
    expect(run).not.toHaveBeenCalled();
    expect(passos.at(-1)).toMatchObject({ decisao: "recusado" });
    // controle: o mesmo caminho, no app aprovado, age
    expect(await executarChamada(getTool("computador_clicar_sintetica")!, { app: "VS Code" }, ctx, opts as never)).toEqual({ mensagem: "cliquei" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("navegador sem authorize: site fora do envelope recusado; subdomínio do envelope e site de escrita do dono passam", async () => {
    sessao = sessaoAtiva({ alvo: "navegador", apps: [], sites: ["empresa.com"] });
    const g = criarGuarda(alinhado);
    const run = vi.fn(async () => "agi");
    expect(await g.executar({ def: navegarSemAuthorize, entrada: { url: "https://evil.example/form" }, risco: "escrita", ctx, run })).toMatchObject({ permitido: false, erro: expect.stringMatching(/evil\.example" não está no envelope/) });
    expect(run).not.toHaveBeenCalled();
    expect(await g.executar({ def: navegarSemAuthorize, entrada: { url: "https://app.empresa.com/x" }, risco: "escrita", ctx, run })).toBe("agi");
    sitesDeEscrita = ["jira.example"];
    expect(await g.executar({ def: navegarSemAuthorize, entrada: { url: "https://jira.example/card" }, risco: "escrita", ctx, run })).toBe("agi");
    // o alvo FIXADO pelo preparar (a URL da aba) é o que conta, não só o topo da entrada
    expect(await g.executar({ def: navegarSemAuthorize, entrada: { fixado: { url: "https://evil.example/" } }, risco: "escrita", ctx, run })).toMatchObject({ permitido: false });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("computador_agir de verdade: os apelidos do app que as mãos viram contam (Bloco de Notas casa \"notepad\"); outro app não", async () => {
    sessao = sessaoAtiva({ apps: ["notepad"] });
    const g = criarGuarda(alinhado);
    const run = vi.fn(async () => "ok");
    const passo = (app: string, nomes: string[]) => ({ acao: "clicar", fixado: { sessaoId: "s1", passos: [{ acao: "clicar", visto: { app, nomesDoApp: nomes }, focado: null, destinoVisto: null }] } });
    expect(await g.executar({ def: agir, entrada: passo("Bloco de Notas", ["notepad", "bloco de notas"]), risco: "escrita", ctx, run })).toBe("ok");
    expect(await g.executar({ def: agir, entrada: passo("Outlook", ["olk", "outlook"]), risco: "escrita", ctx, run })).toMatchObject({ permitido: false, erro: expect.stringMatching(/"Outlook" não está no envelope/) });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("aprovada na fila não reconfere o envelope (o dono viu o alvo); mídia sem sessão também não", async () => {
    sessao = sessaoAtiva({ apps: ["VS Code"] });
    const g = criarGuarda(alinhado);
    expect(await g.executar({ def: clicarSemAuthorize, entrada: { app: "Excel" }, risco: "efeito_externo", ctx, acaoId: "a9", run: async () => "aprovado" })).toBe("aprovado");
    expect(await g.executar({ def: { ...clicarSemAuthorize, semSessao: true }, entrada: { app: "Spotify" }, risco: "escrita", ctx, run: async () => "toquei" })).toBe("toquei");
  });
});
