import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cliente da ponte. O que fica travado:
 *   - mídia acima do teto é recusada SEM entrar inteira na memória;
 *   - sem GOWA_BASIC_AUTH nada é chamado (não há senha padrão);
 *   - endereço da ponte fora de casa é recusado antes da requisição;
 *   - o número do dono não vai para o log (query do login/code).
 */

let ponteUrl = "http://127.0.0.1:3011";
vi.mock("../../settings", () => ({ settings: { getMany: async () => ({ "whatsapp.ponteUrl": ponteUrl, "whatsapp.ponteTimeoutMs": 5000 }) } }));
const warn = vi.fn();
vi.mock("../../observability/logger", () => ({ log: { warn, info: vi.fn(), error: vi.fn() } }));

const c = await import("./client");
const fetchOriginal = globalThis.fetch;
const envOriginal = process.env.GOWA_BASIC_AUTH;

beforeEach(() => {
  vi.clearAllMocks();
  ponteUrl = "http://127.0.0.1:3011";
  process.env.GOWA_BASIC_AUTH = "orbita:segredo";
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (envOriginal === undefined) delete process.env.GOWA_BASIC_AUTH;
  else process.env.GOWA_BASIC_AUTH = envOriginal;
});

const corpoEmPedacos = (pedacos: number[]) =>
  new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const n of pedacos) ctrl.enqueue(new Uint8Array(n));
      ctrl.close();
    },
  });

describe("lerComTeto", () => {
  it("recusa pelo content-length, antes de ler", async () => {
    const res = new Response(corpoEmPedacos([10]), { headers: { "content-length": "999999" } });
    await expect(c.lerComTeto(res, 100)).rejects.toBeInstanceOf(c.MidiaGrandeDemais);
  });

  it("sem content-length, para no meio quando passa do teto", async () => {
    await expect(c.lerComTeto(new Response(corpoEmPedacos([60, 60, 60])), 100)).rejects.toBeInstanceOf(c.MidiaGrandeDemais);
  });

  it("dentro do teto, junta os pedaços", async () => {
    const b = await c.lerComTeto(new Response(corpoEmPedacos([30, 40])), 100);
    expect(b.length).toBe(70);
  });
});

describe("credencial e endereço", () => {
  it("sem GOWA_BASIC_AUTH não chama a ponte", async () => {
    delete process.env.GOWA_BASIC_AUTH;
    globalThis.fetch = vi.fn() as typeof fetch;
    await expect(c.estado("dev1")).rejects.toMatchObject({ motivo: "nao_configurada" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(c.ponteConfigurada()).toBe(false);
  });

  it("ponte fora de casa é recusada antes da requisição", async () => {
    ponteUrl = "https://gowa.exemplo.com";
    globalThis.fetch = vi.fn() as typeof fetch;
    await expect(c.estado("dev1")).rejects.toMatchObject({ motivo: "nao_local" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("manda Basic com a senha configurada e o X-Device-Id", async () => {
    globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>;
      expect(h.Authorization).toBe("Basic " + Buffer.from("orbita:segredo").toString("base64"));
      expect(h["X-Device-Id"]).toBe("dev1");
      return Response.json({ results: { message_id: "M1" } });
    }) as typeof fetch;
    expect(await c.enviarTexto("dev1", "5511@s.whatsapp.net", "oi")).toBe("M1");
  });

  it("'não pareado' vira sem_sessao, e o número do dono não vai para o log", async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"code":"AUTHENTICATION_ERROR"}', { status: 401 })) as typeof fetch;
    await expect(c.parearPorCodigo("dev1", "5511999998888")).rejects.toMatchObject({ motivo: "sem_sessao" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("5511999998888");
  });

  it("timeout vira 'tempo' (num envio, pode ter saído)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    }) as typeof fetch;
    await expect(c.enviarTexto("dev1", "5511@s.whatsapp.net", "oi")).rejects.toMatchObject({ motivo: "tempo" });
  });
});
