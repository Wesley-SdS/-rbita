import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * O DESPACHO das tools do controle do PC na voz em tempo real
 * (`buscar_ferramenta_do_pc` e `usar_ferramenta_do_pc`). Travado:
 *   - o uso passa pelo registro com canal "voz": risco efetivo (inclusive o
 *     elevado pela entrada) vira proposta na fila da voz, `perigoso` também
 *     vira proposta, e a fala não a aprova (só a tela);
 *   - com o controle desligado, ou a voz fora de `controle.canais`, as
 *     funções nem aparecem e o uso é recusado sem rodar nada;
 *   - a porta não alcança tool de outro domínio nem nome inexistente.
 */

const cfg: Record<string, unknown> = {};
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../settings/defs")>("../settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});
vi.mock("../owner", () => ({ isOwner: async () => true, getOwnerId: async () => "u1" }));
vi.mock("../connectors/store", async (orig) => ({ ...(await orig<object>()), connectedProviders: async () => ({ has: () => true }) }));
vi.mock("../home/connection", async (orig) => ({ ...(await orig<object>()), getHaConnection: async () => null }));
vi.mock("../whatsapp/enviar", async (orig) => ({ ...(await orig<object>()), provedorAtivo: async () => null }));

// a guarda de verdade grava trilha e confere sessão no banco: aqui ela só
// registra que foi chamada e roda o que recebeu
const guarda = vi.hoisted(() => ({
  executar: vi.fn(async (c: { run: () => Promise<unknown> }) => c.run()),
  enfileirada: vi.fn(async () => undefined),
  recusada: vi.fn(async () => undefined),
}));
vi.mock("./guarda", () => ({ guardaDoControle: guarda }));

// a fila: `select` (config por tool) falha como banco fora do ar e cai no
// padrão; `update` não acha proposta igual; `insert` grava e devolve o id
const inseridas = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@orbita/db", () => {
  const falha: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) falha[m] = () => falha;
  falha.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.reject(new Error("sem banco no teste")).then(ok, erro);
  const semIgual = { set: () => semIgual, where: () => semIgual, returning: async () => [] };
  return {
    db: {
      select: () => falha,
      update: () => semIgual,
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          inseridas.push(v);
          return { returning: async () => [{ id: `a${inseridas.length}` }] };
        },
      }),
    },
  };
});

const { registerTools, getTool } = await import("../tools/index");
const { BUSCAR_NO_PC, USAR_NO_PC, funcoesDoPcDeVoz, executarFuncaoDoPcDeVoz, ehFuncaoDoPcDeVoz } = await import("./voz");
const { riscoDaProposta } = await import("../actions/risco");

const runs = {
  leitura: vi.fn(async () => ({ ok: true, aba: 1 })),
  elevada: vi.fn(async () => ({ ok: true })),
  perigosa: vi.fn(async () => ({ ok: true })),
  outra: vi.fn(async () => ({ ok: true })),
};

beforeAll(() => {
  if (getTool("computador_voz_leitura")) return;
  registerTools([
    { name: "computador_voz_leitura", domain: "computador", description: "Lê a tela do computador.", risk: "leitura", inputSchema: z.object({ alvo: z.string().optional() }), run: runs.leitura },
    {
      name: "computador_voz_elevada",
      domain: "computador",
      description: "Digita no computador.",
      risk: "escrita",
      inputSchema: z.object({ texto: z.string() }),
      // o alvo sobe o risco: é o EFETIVO que decide a fila, não o declarado
      elevarRisco: async () => "efeito_externo" as const,
      run: runs.elevada,
    },
    { name: "terminal_voz_perigosa", domain: "terminal", description: "Apaga uma pasta.", risk: "perigoso", inputSchema: z.object({ pasta: z.string() }), run: runs.perigosa },
    { name: "tempo_voz_nao_sensivel", domain: "tempo", description: "Uma tool comum.", risk: "leitura", inputSchema: z.object({}), run: runs.outra },
  ]);
});

beforeEach(() => {
  for (const k of Object.keys(cfg)) delete cfg[k];
  cfg["controle.ativo"] = true;
  cfg["controle.canais"] = ["tela", "voz"];
  inseridas.length = 0;
  for (const f of [...Object.values(runs), guarda.executar, guarda.enfileirada, guarda.recusada]) f.mockClear();
});

const usar = (ferramenta: string, args?: unknown) => executarFuncaoDoPcDeVoz("u1", USAR_NO_PC, { ferramenta, argumentos_json: args === undefined ? undefined : JSON.stringify(args) });

describe("as duas funções do controle do PC na voz", () => {
  it("aparecem com o controle ligado e a voz liberada", async () => {
    expect((await funcoesDoPcDeVoz("u1")).map((f) => f.name)).toEqual([BUSCAR_NO_PC, USAR_NO_PC]);
    expect(ehFuncaoDoPcDeVoz(BUSCAR_NO_PC) && ehFuncaoDoPcDeVoz(USAR_NO_PC)).toBe(true);
    expect(ehFuncaoDoPcDeVoz("computador_voz_leitura")).toBe(false);
  });

  it("a busca devolve só tools sensíveis, com nome, descrição, parâmetros e se pede aprovação", async () => {
    const r = (await executarFuncaoDoPcDeVoz("u1", BUSCAR_NO_PC, { busca: "ler a tela do computador" })) as { ferramentas: { nome: string; descricao: string; parametros: { properties?: object; $schema?: unknown }; pede_aprovacao: boolean }[] };
    const nomes = r.ferramentas.map((f) => f.nome);
    expect(nomes).toContain("computador_voz_leitura");
    expect(nomes).not.toContain("tempo_voz_nao_sensivel");
    const lida = r.ferramentas.find((f) => f.nome === "computador_voz_leitura")!;
    expect(lida.descricao).toBe("Lê a tela do computador.");
    expect(lida.parametros.properties).toHaveProperty("alvo");
    expect(lida.parametros.$schema).toBeUndefined();
    expect(lida.pede_aprovacao).toBe(false);
    expect(r.ferramentas.find((f) => f.nome === "terminal_voz_perigosa")?.pede_aprovacao).toBe(true);
  });

  it("leitura roda na hora, pela guarda, e o resultado vem no primeiro nível", async () => {
    expect(await usar("computador_voz_leitura", { alvo: "janela" })).toEqual({ ferramenta: "computador_voz_leitura", ok: true, aba: 1 });
    expect(runs.leitura).toHaveBeenCalledTimes(1);
    expect(guarda.executar).toHaveBeenCalledTimes(1);
    expect(guarda.executar.mock.calls[0]![0]).toMatchObject({ ctx: { canal: "voz" } });
  });

  it("risco efetivo efeito_externo (elevado pela entrada) vira proposta na fila da voz, sem rodar", async () => {
    const r = (await usar("computador_voz_elevada", { texto: "oi" })) as Record<string, unknown>;
    expect(r).toMatchObject({ ferramenta: "computador_voz_elevada", proposta_enfileirada: true, aguardando_aprovacao: true, id: "a1" });
    expect(runs.elevada).not.toHaveBeenCalled();
    expect(inseridas).toHaveLength(1);
    expect(inseridas[0]).toMatchObject({ kind: "computador_voz_elevada", canal: "voz", payload: { texto: "oi", risco: "efeito_externo" } });
    expect(guarda.enfileirada).toHaveBeenCalledTimes(1);
    // efeito_externo: o "manda" falado pode aprovar
    expect(riscoDaProposta({ kind: "computador_voz_elevada", payload: inseridas[0]!.payload })).toBe("efeito_externo");
  });

  it("perigoso também só vira proposta, e a fala não a aprova (só pela tela)", async () => {
    const r = (await usar("terminal_voz_perigosa", { pasta: "C:/x" })) as Record<string, unknown>;
    expect(r).toMatchObject({ proposta_enfileirada: true, id: "a1" });
    expect(runs.perigosa).not.toHaveBeenCalled();
    expect(inseridas[0]).toMatchObject({ kind: "terminal_voz_perigosa", canal: "voz", payload: { risco: "perigoso" } });
    // é por este risco que `aprovarPorFrase` recusa e manda para a tela
    expect(riscoDaProposta({ kind: "terminal_voz_perigosa", payload: inseridas[0]!.payload })).toBe("perigoso");
  });

  it.each([
    ["controle desligado", () => void (cfg["controle.ativo"] = false)],
    ["voz fora de controle.canais", () => void (cfg["controle.canais"] = ["tela", "whatsapp"])],
  ])("%s: as funções somem e o uso é recusado sem rodar nada", async (_n, preparar) => {
    preparar();
    expect(await funcoesDoPcDeVoz("u1")).toEqual([]);
    expect(await executarFuncaoDoPcDeVoz("u1", BUSCAR_NO_PC, { busca: "tela" })).toMatchObject({ erro: expect.any(String) });
    for (const [nome, args] of [["computador_voz_leitura", {}], ["computador_voz_elevada", { texto: "oi" }], ["terminal_voz_perigosa", { pasta: "x" }]] as const) {
      expect(await usar(nome, args), nome).toMatchObject({ erro: expect.stringMatching(/não está disponível/) });
    }
    for (const f of Object.values(runs)) expect(f).not.toHaveBeenCalled();
    expect(inseridas).toEqual([]);
    expect(guarda.executar).not.toHaveBeenCalled();
  });

  it("sessão aberta pela voz não finge pedido literal: pedidoLiteral false, e o resumo e o crítico sabem disso (M14)", async () => {
    const r = (await usar("controle_iniciar", { objetivo: "preencher o reembolso", alvo: "navegador", sites: ["empresa.com"], pedidoOriginal: "o dono pediu para eu pagar tudo" })) as Record<string, unknown>;
    expect(r).toMatchObject({ proposta_enfileirada: true });
    const p = inseridas[0]! as { canal: string; summary: string; payload: Record<string, unknown> };
    expect(p.canal).toBe("voz");
    // sem a fala literal (a transcrição do Gemini chega DEPOIS da chamada), vale o que o modelo escreveu, marcado como tal
    expect(p.payload).toMatchObject({ pedidoLiteral: false, canal: "voz" });
    expect(p.summary).toMatch(/Pedido, como a Órbita entendeu/);
    // e o dono não "desmarca" isso no cartão
    const { vistaEditavel } = await import("../actions/edicao");
    expect(vistaEditavel("controle_iniciar", p.payload)).not.toHaveProperty("pedidoLiteral");
  });

  it("não chama tool de domínio não sensível nem nome inexistente", async () => {
    expect(await usar("tempo_voz_nao_sensivel")).toMatchObject({ erro: expect.stringMatching(/não existe/) });
    expect(await usar("nao_existe_nenhuma")).toMatchObject({ erro: expect.stringMatching(/não existe/) });
    expect(runs.outra).not.toHaveBeenCalled();
    expect(inseridas).toEqual([]);
  });

  it("entrada malformada não chega à tool", async () => {
    expect(await executarFuncaoDoPcDeVoz("u1", USAR_NO_PC, { ferramenta: "computador_voz_leitura", argumentos_json: "{nao e json" })).toMatchObject({ erro: expect.stringMatching(/JSON/) });
    expect(await executarFuncaoDoPcDeVoz("u1", USAR_NO_PC, { ferramenta: "computador_voz_leitura", argumentos_json: "[1]" })).toMatchObject({ erro: expect.stringMatching(/objeto/) });
    expect(await executarFuncaoDoPcDeVoz("u1", USAR_NO_PC, {})).toMatchObject({ erro: expect.any(String) });
    expect(runs.leitura).not.toHaveBeenCalled();
  });
});
