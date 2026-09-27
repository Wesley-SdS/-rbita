import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A cadeia de fala saiu da rota para o core (a nota de voz do WhatsApp usa a
 * mesma). O que fica travado: cada degrau só entra se o anterior falhou, a
 * interrupção (barge-in) não cai para o próximo, e a conversão para nota de
 * voz fala com o serviço de voz.
 */

const edge = vi.fn();
const gemini = vi.fn();
let edgeOk = true;
let geminiOk = true;

vi.mock("./tts-edge", () => ({ EDGE_MIME: "audio/mpeg", edgeTtsAvailable: () => edgeOk, synthesizeEdge: edge }));
vi.mock("./tts-gemini", () => ({ geminiTtsAvailable: () => geminiOk, synthesizeGemini: gemini }));
vi.mock("./service-url", () => ({ voiceServiceUrl: () => "http://voz" }));
vi.mock("../usage/registrar", () => ({ FLUXO: { tts: "tts" }, registrarUso: vi.fn() }));

const { FalaError, paraNotaDeVoz, sintetizarFala } = await import("./sintetizar");

const fetchOriginal = globalThis.fetch;
beforeEach(() => {
  vi.clearAllMocks();
  edgeOk = geminiOk = true;
  delete process.env.TTS_PROVIDER;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("sintetizarFala", () => {
  it("Edge primeiro", async () => {
    edge.mockResolvedValueOnce(Buffer.from([1, 2]));
    const f = await sintetizarFala("oi", { userId: "u1" });
    expect(f).toMatchObject({ mime: "audio/mpeg", servico: "edge-tts" });
    expect(gemini).not.toHaveBeenCalled();
  });

  it("Edge falhou: Gemini; Gemini falhou: Piper", async () => {
    edge.mockRejectedValueOnce(new Error("edge fora"));
    gemini.mockRejectedValueOnce(new Error("cota"));
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 })) as typeof fetch;
    const f = await sintetizarFala("oi");
    expect(f).toMatchObject({ mime: "audio/wav", servico: "piper" });
  });

  it("interrompida não cai para o próximo degrau", async () => {
    const ac = new AbortController();
    ac.abort();
    edge.mockRejectedValueOnce(new Error("abort"));
    await expect(sintetizarFala("oi", { signal: ac.signal })).rejects.toMatchObject({ status: 499 });
    expect(gemini).not.toHaveBeenCalled();
  });

  it("interrompida DURANTE o Piper é 499, não 'serviço fora'", async () => {
    edgeOk = geminiOk = false;
    const ac = new AbortController();
    globalThis.fetch = vi.fn(async () => {
      ac.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as typeof fetch;
    await expect(sintetizarFala("oi", { signal: ac.signal })).rejects.toMatchObject({ status: 499 });
  });

  it("length_scale chega ao Piper", async () => {
    edgeOk = geminiOk = false;
    globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ text: "oi", length_scale: 1.2 });
      return new Response(new Uint8Array([1]), { status: 200 });
    }) as typeof fetch;
    await sintetizarFala("oi", { lengthScale: 1.2 });
  });

  it("provedor fixado que falha não tenta os outros", async () => {
    process.env.TTS_PROVIDER = "edge";
    edge.mockRejectedValueOnce(new Error("edge fora"));
    await expect(sintetizarFala("oi")).rejects.toBeInstanceOf(FalaError);
    expect(gemini).not.toHaveBeenCalled();
  });

  it("serviço de voz fora do ar: 503", async () => {
    edgeOk = geminiOk = false;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    await expect(sintetizarFala("oi")).rejects.toMatchObject({ status: 503 });
  });
});

describe("paraNotaDeVoz", () => {
  it("OGG já está pronto", async () => {
    const f = { bytes: new Uint8Array([1]), mime: "audio/ogg; codecs=opus" };
    expect(await paraNotaDeVoz(f)).toBe(f);
  });

  it("MP3 vai ao serviço de voz e volta OGG/Opus", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("http://voz/converter/ogg");
      return new Response(new Uint8Array([79, 103, 103, 83]), { status: 200 });
    }) as typeof fetch;
    const r = await paraNotaDeVoz({ bytes: new Uint8Array([1]), mime: "audio/mpeg" });
    expect(r.mime).toBe("audio/ogg; codecs=opus");
    expect([...r.bytes]).toEqual([79, 103, 103, 83]);
  });

  it("conversão falhou: erro (quem chama manda o MP3 como anexo)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("x", { status: 422 })) as typeof fetch;
    await expect(paraNotaDeVoz({ bytes: new Uint8Array([1]), mime: "audio/wav" })).rejects.toBeInstanceOf(FalaError);
  });
});
