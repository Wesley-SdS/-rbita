import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * O CONTROLE DO PC percorrendo o REGISTRO INTEIRO (PRD-COMPUTADOR-E-NAVEGADOR
 * F1 e F3). Os testes não listam tools: pegam toda tool dos domínios
 * sensíveis (controle, terminal, arquivos, computador, navegador) que estiver
 * registrada, inclusive as que as frentes A e B registrarem depois. Uma tool
 * nova de terminal que esquecer qualquer coisa reprova aqui.
 *
 * Travado:
 *   - nenhuma delas (nem as de leitura) aparece com o controle desligado, num
 *     canal fora de `controle.canais`, em turno de evento de terceiro, em
 *     turno de pessoa da casa (nem com o domínio na lista da família) e para
 *     quem não é o dono da instância; na voz em tempo real, nunca declaradas
 *     uma a uma (chegam pelo despacho de `controle/voz.ts`, teto de 128);
 *   - nenhuma roda sem passar pela guarda (trilha gravada antes);
 *   - a resposta automática do WhatsApp não monta tool nenhuma.
 */

const cfg: Record<string, unknown> = {};
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../settings/defs")>("../settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});
let dono = true;
vi.mock("../owner", () => ({ isOwner: async () => dono, getOwnerId: async () => (dono ? "u1" : "outro") }));
// todo conector "conectado": o que some, some pelo controle do PC, não por falta de conta
vi.mock("../connectors/store", async (orig) => ({ ...(await orig<object>()), connectedProviders: async () => ({ has: () => true }) }));
vi.mock("../home/connection", async (orig) => ({ ...(await orig<object>()), getHaConnection: async () => ({ url: "http://ha", token: "x" }) }));
vi.mock("../whatsapp/enviar", async (orig) => ({ ...(await orig<object>()), provedorAtivo: async () => "pessoal" }));
// sem banco: a configuração por tool cai no padrão (todas ligadas, risco declarado)
// a consulta inteira falha no fim (where, orderBy, limit encadeados), como um banco fora do ar: tool que
// consulta a sessão no `authorize` (as do Chrome) recusa, em vez de estourar uma promessa sem dono
vi.mock("@orbita/db", () => {
  const cadeia: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin"]) cadeia[m] = () => cadeia;
  cadeia.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.reject(new Error("sem banco no teste")).then(ok, erro);
  return { db: { select: () => cadeia } };
});

// um servidor MCP ligado: as duas funções do MCP entram na lista da voz e contam no teto
vi.mock("../mcp/client", async (orig) => ({
  ...(await orig<object>()),
  ferramentasMcpDoDono: async () => [{ chave: "gestao__listar", servidor: "gestao", descricao: "Lista.", risco: "leitura", inputSchema: { type: "object", properties: {} } }],
}));

const tools = await import("./index");
const { ehToolSensivel, DOMINIOS_SENSIVEIS } = await import("../controle/dominios");
const { funcoesDoPcDeVoz } = await import("../controle/voz");
const { funcoesDaVoz } = await import("../realtime/funcoes");
const { registerTools, listRegisteredTools, getTool, executarChamada, toToolSet } = tools;

/** Uma tool sintética por domínio sensível, de cada risco: o teste vale antes de as frentes A e B existirem. */
beforeAll(() => {
  for (const d of DOMINIOS_SENSIVEIS) {
    for (const risk of ["leitura", "escrita", "efeito_externo"] as const) {
      const name = `${d}_sintetica_${risk}`;
      if (!getTool(name)) registerTools([{ name, domain: d, description: `Sintética de ${d}.`, risk, inputSchema: z.object({}), run: async () => ({ ok: true }) }]);
    }
  }
});

beforeEach(() => {
  for (const k of Object.keys(cfg)) delete cfg[k];
  cfg["controle.ativo"] = true;
  cfg["controle.canais"] = ["tela", "voz", "whatsapp"];
  dono = true;
});

const sensiveis = () => listRegisteredTools().filter(ehToolSensivel);
/** As que têm mão disponível agora (a tool do apps/maos some com ele desligado, e isso não é o que se testa aqui). */
const sensiveisComMao = () => sensiveis().filter((t) => !t.requires?.available || t.requires.available());
const nomesSensiveis = (set: Record<string, unknown>) => Object.keys(set).filter((n) => sensiveis().some((t) => t.name === n));

describe("as tools sensíveis só entram no turno do dono, no canal liberado", () => {
  it("controle (de verdade): com tudo liberado, TODAS as sensíveis registradas entram", async () => {
    const set = await tools.buildToolSet("u1", "", undefined, undefined, undefined, undefined, "tela", false, true);
    expect(sensiveis().length).toBeGreaterThanOrEqual(3 + DOMINIOS_SENSIVEIS.length * 3);
    expect(nomesSensiveis(set).sort()).toEqual(sensiveisComMao().map((t) => t.name).sort());
    expect(Object.keys(set)).toContain("controle_iniciar");
  });

  it.each([
    ["controle desligado", () => void (cfg["controle.ativo"] = false), { canal: "tela" as const }],
    ["canal fora da lista (Telegram)", () => undefined, { canal: "telegram" as const }],
    ["lista de canais vazia", () => void (cfg["controle.canais"] = []), { canal: "tela" as const }],
    ["conta que não é a dona", () => void (dono = false), { canal: "tela" as const }],
    ["regra disparada por terceiro (só leitura)", () => undefined, { canal: "tela" as const, soLeitura: true }],
    ["pessoa da casa, mesmo com os domínios na lista dela", () => undefined, { canal: "telegram" as const, pessoaDaCasa: true, dominios: [...DOMINIOS_SENSIVEIS] }],
  ])("%s: nenhuma, nem as de leitura", async (_n, preparar, c) => {
    preparar();
    if ((c as { pessoaDaCasa?: boolean }).pessoaDaCasa) cfg["controle.canais"] = ["tela", "voz", "whatsapp", "telegram"];
    const set = await tools.buildToolSet("u1", "", undefined, undefined, undefined, (c as { dominios?: string[] }).dominios, c.canal, Boolean((c as { soLeitura?: boolean }).soLeitura), true, { pessoaDaCasa: (c as { pessoaDaCasa?: boolean }).pessoaDaCasa });
    expect(nomesSensiveis(set)).toEqual([]);
  });

  it("voz em tempo real: nunca declaradas uma a uma; sem controle ligado, nem o despacho as alcança", async () => {
    cfg["controle.ativo"] = false;
    expect((await tools.toolDefsForRealtime("u1")).filter(ehToolSensivel)).toEqual([]);
    expect(await tools.sensiveisDaVoz("u1")).toEqual([]);
    expect(await funcoesDoPcDeVoz("u1")).toEqual([]);
    expect(await tools.runRealtimeTool("u1", "controle_status", {})).toMatchObject({ erro: expect.stringMatching(/não está disponível/) });
    cfg["controle.ativo"] = true;
    // ligado: continuam fora da lista nativa (teto da OpenAI) e chegam pelo despacho
    expect((await tools.toolDefsForRealtime("u1")).filter(ehToolSensivel)).toEqual([]);
    expect((await tools.sensiveisDaVoz("u1")).map((t) => t.name).sort()).toEqual(sensiveisComMao().map((t) => t.name).sort());
    expect((await funcoesDoPcDeVoz("u1")).map((f) => f.name)).toEqual(["buscar_ferramenta_do_pc", "usar_ferramenta_do_pc"]);
    // pelo nome direto, nem com o controle ligado: a porta é o despacho
    expect(await tools.runRealtimeTool("u1", "controle_status", {})).toMatchObject({ erro: expect.stringMatching(/usar_ferramenta_do_pc/) });
  });

  it("catálogo da tela mostra a exigência e a disponibilidade de verdade", async () => {
    cfg["controle.ativo"] = false;
    const cat = await tools.toolCatalog("u1");
    for (const t of cat.filter((x) => sensiveis().some((s) => s.name === x.name))) {
      expect(t.requires, t.name).toBe("controle");
      expect(t.available, t.name).toBe(false);
    }
  });
});

describe("nenhuma tool sensível roda sem a guarda (trilha antes de executar)", () => {
  /** Roda cada tool sensível com `run` espiado: ele só pode ser chamado DE DENTRO da guarda. */
  async function percorrer(chamar: (def: ReturnType<typeof sensiveis>[number], guarda: Parameters<typeof executarChamada>[3]["guarda"]) => Promise<unknown>) {
    for (const original of sensiveis()) {
      let dentro = false;
      const foraDaGuarda: string[] = [];
      const run = vi.fn(async () => {
        if (!dentro) foraDaGuarda.push(original.name);
        return { ok: true };
      });
      const def = { ...original, run };
      const guarda = {
        executar: vi.fn(async (c: { run: () => Promise<unknown> }) => {
          dentro = true;
          try {
            return await c.run();
          } finally {
            dentro = false;
          }
        }),
        enfileirada: vi.fn(async () => undefined),
        recusada: vi.fn(async () => undefined),
      };
      let lancou = false;
      await chamar(def, guarda).catch(() => {
        lancou = true;
      });
      expect(foraDaGuarda, `${original.name} rodou fora da guarda`).toEqual([]);
      const viuAGuarda = guarda.executar.mock.calls.length + guarda.enfileirada.mock.calls.length + guarda.recusada.mock.calls.length;
      // ou a guarda soube da chamada, ou ela parou ANTES de rodar (entrada inválida para a tool)
      expect(viuAGuarda > 0 || (lancou && run.mock.calls.length === 0), `${original.name} não passou pela guarda`).toBe(true);
    }
  }
  const enqueue = async (_d: unknown, _i: unknown, resumo: string) => ({ proposta_enfileirada: true as const, aguardando_aprovacao: true as const, id: "a1", resumo });

  it("pelo caminho do registro (chat, voz, laço delegado)", async () => {
    await percorrer((def, guarda) => executarChamada(def, {}, { userId: "u1", canal: "tela" }, { enqueue, guarda }));
  });

  it("pelo ToolSet do AI SDK", async () => {
    await percorrer((def, guarda) => toToolSet([def], { userId: "u1", canal: "tela" }, { enqueue, guarda })[def.name]!.execute!({}, { toolCallId: "t", messages: [], context: {} } as never));
  });

  it("sem guarda no caminho, nenhuma roda", async () => {
    for (const def of sensiveis()) {
      const run = vi.fn();
      expect(await executarChamada({ ...def, run }, {}, { userId: "u1" }, { enqueue }), def.name).toMatchObject({ permitido: false });
      expect(run).not.toHaveBeenCalled();
    }
  });
});

describe("teto da voz em tempo real", () => {
  it("a lista que a sessão declara, com o controle ligado e um servidor MCP, cabe no limite da OpenAI Realtime (128)", async () => {
    // a voz recebe todas as tools nativas (decisão de 27/09/2026), menos as do
    // controle do PC, que chegam por duas funções de despacho; as do MCP, por
    // outras duas. É exatamente o que `realtime-session.ts` manda
    const lista = await funcoesDaVoz("u1");
    const nomes = lista.map((f) => f.name);
    expect(nomes).toEqual(expect.arrayContaining(["buscar_ferramenta_do_pc", "usar_ferramenta_do_pc", "buscar_ferramenta_externa", "usar_ferramenta_externa"]));
    expect(lista.filter((f) => sensiveis().some((s) => s.name === f.name))).toEqual([]);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(lista.length).toBeLessThanOrEqual(128);
  });

  it("no pior caso (toda tool não sensível disponível), também cabe", () => {
    // uma chave de ambiente ou um conector novo pode trazer de volta uma tool
    // que os mocks deste teste deixam de fora: conta o registro inteiro
    const naoSensiveis = listRegisteredTools().filter((t) => !ehToolSensivel(t));
    expect(naoSensiveis.length + 2 + 2).toBeLessThanOrEqual(128);
  });

  it("passou do teto (realtime.toolsMax): corta as nativas do fim, nunca as de despacho, e a sessão abre", async () => {
    cfg["realtime.toolsMax"] = 20;
    try {
      const lista = await funcoesDaVoz("u1");
      expect(lista.length).toBe(20);
      expect(lista.map((f) => f.name)).toEqual(expect.arrayContaining(["buscar_ferramenta_do_pc", "usar_ferramenta_do_pc", "buscar_ferramenta_externa", "usar_ferramenta_externa"]));
    } finally {
      delete cfg["realtime.toolsMax"];
    }
    // controle: no padrão, ninguém é cortado
    expect((await funcoesDaVoz("u1")).length).toBeGreaterThan(20);
  });
});

describe("resposta automática do WhatsApp", () => {
  it("não monta tool nenhuma (e por isso nunca alcança o controle do PC)", () => {
    const fonte = readFileSync(new URL("../whatsapp/automatico.ts", import.meta.url), "utf-8");
    expect(fonte).not.toMatch(/from "\.\.\/(chat\/tools|tools\/index|tools\/registry)"/);
    expect(fonte).not.toMatch(/buildAllTools|buildToolSet|toToolSet|executarPeloRegistro/);
  });
});
