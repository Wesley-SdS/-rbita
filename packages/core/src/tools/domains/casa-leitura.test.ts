import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As tools de casa que faltavam teste (§5.7): listar cômodos, buscar
 * dispositivo, consultar estado e ativar cena.
 *
 * O `casa.test.ts` cobre a defesa contra redirecionamento de alvo, que é a
 * parte perigosa. Falta o caminho normal, e nele o que importa é:
 *
 *   - Home Assistant fora do ar responde EXPLICANDO, e não estoura no meio do
 *     turno do chat (a resposta inteira se perderia por causa de uma lâmpada);
 *   - ativar cena é `escrita` com `authorize`, então a permissão por cômodo é
 *     aplicada pelo registro. Cena está fora do gate de propósito: ajustar
 *     ambiente é reversível, destrancar não.
 */

let comodos: { id: string; name: string }[] = [];
let encontrados: { entityId: string; friendlyName: string; domain: string; state: string; roomId: string | null }[] = [];
let estado: { entity_id: string; state: string; attributes: Record<string, unknown> } | null = null;
let haFora = false; // não cadastrado
let haErra = false; // cadastrado, mas o HA não responde
const servicos: { dominio: string; servico: string; dados: unknown }[] = [];
let recusaComodo: string | null = null;

function consulta() {
  const p: Record<string, unknown> = {};
  const enc = () => p;
  p.from = enc;
  p.where = enc;
  p.orderBy = enc;
  p.limit = enc;
  p.then = (r: (v: unknown[]) => unknown) => r(comodos);
  return p;
}

class ErroHaFalso extends Error {}

vi.mock("@orbita/db", () => ({ db: { select: () => consulta() } }));
vi.mock("../../home/connection", () => ({
  getHaConnection: async () => (haFora ? null : { baseUrl: "http://ha", token: "t" }),
}));
vi.mock("../../home/entities", () => ({
  entitiesInRoom: async () => encontrados,
  findEntities: async () => encontrados,
}));
vi.mock("../../home/access", () => ({ loadDomainRiskOverrides: async () => new Map() }));
vi.mock("../../home/room-permission", () => ({
  authorizeRoomForRequester: async () => recusaComodo,
  authorizeEntityForRequester: async () => recusaComodo,
  allowedRooms: async (ids: (string | null)[]) => new Set(ids),
}));
vi.mock("../../home/client", () => ({
  HomeAssistantError: ErroHaFalso,
  getState: async () => {
    if (!estado) throw new ErroHaFalso("Home Assistant não respondeu");
    return estado;
  },
  callService: async (_b: string, _t: string, dominio: string, servico: string, dados: unknown) => {
    if (haErra) throw new ErroHaFalso("Home Assistant não respondeu");
    servicos.push({ dominio, servico, dados });
  },
}));

const { _resetRegistry, toToolSet, getTool } = await import("../registry");
await import("./casa");

const ctx = { userId: "u1" } as Parameters<typeof toToolSet>[1];
const propostas: string[] = [];
const gate = {
  enqueue: async (d: { name: string }) => {
    propostas.push(d.name);
    return { id: "a1" };
  },
} as unknown as Parameters<typeof toToolSet>[2];

function executar(nome: string, input: unknown = {}) {
  const set = toToolSet([getTool(nome)!], ctx, gate);
  const tool = set[nome] as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  return tool.execute(input, { toolCallId: "c1", messages: [] });
}

beforeEach(() => {
  comodos = [];
  encontrados = [];
  estado = null;
  haFora = false;
  haErra = false;
  recusaComodo = null;
  servicos.length = 0;
  propostas.length = 0;
});

describe("listar cômodos", () => {
  it("devolve os cômodos do dono", async () => {
    comodos = [{ id: "r1", name: "Cozinha" }, { id: "r2", name: "Sala" }];
    const r = (await executar("casa_listar_comodos")) as { comodos: { nome: string }[] };
    expect(r.comodos.map((c) => c.nome)).toEqual(["Cozinha", "Sala"]);
  });

  it("casa sem cômodo cadastrado devolve lista vazia, não erro", async () => {
    const r = (await executar("casa_listar_comodos")) as { comodos: unknown[] };
    expect(r.comodos).toEqual([]);
  });
});

describe("buscar dispositivos", () => {
  it("acha o que casa com a consulta", async () => {
    encontrados = [{ entityId: "light.sala", friendlyName: "Luz da sala", domain: "light", state: "on", roomId: "r2" }];
    const r = (await executar("casa_buscar_dispositivos", { consulta: "luz da sala" })) as Record<string, unknown>;
    expect(JSON.stringify(r)).toContain("light.sala");
  });

  it("nada encontrado não vira erro", async () => {
    const r = (await executar("casa_buscar_dispositivos", { consulta: "nave espacial" })) as Record<string, unknown>;
    expect(r).toBeTruthy();
  });
});

describe("consultar estado", () => {
  it("devolve estado e atributos", async () => {
    estado = { entity_id: "light.sala", state: "on", attributes: { brightness: 200 } };
    const r = (await executar("casa_consultar_estado", { entidade: "light.sala" })) as { estado?: string; atributos?: Record<string, unknown> };
    expect(r.estado).toBe("on");
    expect(r.atributos).toEqual({ brightness: 200 });
  });

  it("Home Assistant que não responde EXPLICA em vez de estourar", async () => {
    // estourar aqui perderia a resposta inteira do chat por causa de uma lâmpada
    const r = (await executar("casa_consultar_estado", { entidade: "light.sala" })) as { erro?: string };
    expect(r.erro).toBeTruthy();
  });

  it("sem Home Assistant conectado, a falha diz o que fazer", async () => {
    // aqui o erro SOBE em vez de virar `{erro}`: é antes do try, em
    // `requireConnection`. O AI SDK entrega a mensagem ao modelo, e ela já
    // aponta o caminho ("Cadastre em Casa > Home Assistant"), então o turno
    // continua com resposta útil em vez de silêncio.
    haFora = true;
    await expect(executar("casa_consultar_estado", { entidade: "light.sala" })).rejects.toThrow(/não conectado/i);
  });
});

describe("ativar cena", () => {
  it("chama o serviço scene.turn_on com a cena pedida", async () => {
    const r = (await executar("casa_ativar_cena", { entidade: "scene.boa_noite" })) as { ativada?: boolean };
    expect(r.ativada).toBe(true);
    expect(servicos).toEqual([{ dominio: "scene", servico: "turn_on", dados: { entity_id: "scene.boa_noite" } }]);
  });

  it("cena NÃO passa pelo gate: ajustar ambiente é reversível", async () => {
    await executar("casa_ativar_cena", { entidade: "scene.cinema" });
    expect(propostas).toEqual([]);
  });

  it("permissão por cômodo recusa ANTES de chamar o Home Assistant", async () => {
    recusaComodo = "Você não tem acesso a esse cômodo.";
    const r = (await executar("casa_ativar_cena", { entidade: "scene.quarto" })) as Record<string, unknown>;
    expect(servicos).toEqual([]);
    expect(JSON.stringify(r)).toContain("acesso");
  });

  it("falha do Home Assistant vira recado, não exceção", async () => {
    // conectado, mas o HA não respondeu: aqui é DENTRO do try, e vira `{erro}`
    haErra = true;
    const r = (await executar("casa_ativar_cena", { entidade: "scene.boa_noite" })) as Record<string, unknown>;
    expect(JSON.stringify(r)).toMatch(/erro|Falha|Home Assistant/i);
  });
});

afterAll(() => _resetRegistry());
