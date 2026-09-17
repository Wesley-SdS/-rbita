import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cliente do serviço LOCAL de percepção. O que este arquivo cobre é o
 * tratamento de erro, porque é ele que decide o que a tela mostra e o que o
 * chamador faz (tentar de novo ou desistir):
 *
 *   - serviço fora do ar vira 503 (é indisponibilidade, não pedido errado);
 *   - 422 e 413 do serviço são repassados, porque dizem respeito ao que foi
 *     enviado (áudio ilegível, arquivo grande demais);
 *   - qualquer outro status vira 502: erro DELE, não do pedido;
 *   - URL que não é desta casa é recusada antes de qualquer coisa sair
 *     (CLAUDE.md §5.4.1, biometria nunca sai de casa), sem depender do guard de
 *     saída do processo.
 */

const cfg = vi.hoisted(() => ({ url: "http://127.0.0.1:8002", timeoutMs: 1000 }));
vi.mock("../settings", () => ({
  settings: {
    getMany: async () => ({ "identity.perceptionUrl": cfg.url, "identity.perceptionTimeoutMs": cfg.timeoutMs }),
    get: async () => "",
  },
}));

import { BIOMETRIC_HEADER } from "../privacy/egress";
import { PerceptionError, detectGestures, embedVoice, perceptionHealth } from "./client";

const IMAGEM = new Uint8Array([1, 2, 3]);
const chamadas: { url: string; init: RequestInit | undefined }[] = [];

/** Resposta de HTTP suficiente para o cliente: status e corpo JSON. */
const resposta = (status: number, corpo: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (corpo === undefined) throw new Error("corpo não é JSON");
      return corpo;
    },
  }) as unknown as Response;

function responder(fn: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    chamadas.push({ url, init });
    return Promise.resolve(fn(url));
  });
}

beforeEach(() => {
  chamadas.length = 0;
  cfg.url = "http://127.0.0.1:8002";
  delete process.env.PERCEPTION_TOKEN;
});
afterEach(() => vi.unstubAllGlobals());

describe("a URL precisa ser desta casa", () => {
  it("endereço de nuvem é recusado sem nada sair", async () => {
    cfg.url = "https://percepcao.exemplo.com";
    responder(() => resposta(200, {}));

    const erro = await detectGestures(IMAGEM, "image/jpeg").catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(PerceptionError);
    expect(erro).toMatchObject({ status: 400 });
    expect((erro as Error).message).toMatch(/nesta casa/);
    expect(chamadas).toHaveLength(0);
  });

  it("URL inválida falha fechada (não vira requisição)", async () => {
    cfg.url = "isso não é uma URL";
    responder(() => resposta(200, {}));

    await expect(detectGestures(IMAGEM, "image/jpeg")).rejects.toMatchObject({ status: 400 });
    expect(chamadas).toHaveLength(0);
  });

  it("saúde nunca estoura: URL de fora devolve null", async () => {
    cfg.url = "https://percepcao.exemplo.com";
    responder(() => resposta(200, { status: "ok" }));

    expect(await perceptionHealth()).toBeNull();
    expect(chamadas).toHaveLength(0);
  });
});

describe("erro do serviço vira status certo para quem chamou", () => {
  it("fora do ar é 503, com a causa no texto", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("fetch failed: ECONNREFUSED")));

    const erro = await detectGestures(IMAGEM, "image/jpeg").catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(PerceptionError);
    expect(erro).toMatchObject({ status: 503 });
    expect((erro as Error).message).toMatch(/fora do ar.*ECONNREFUSED/);
  });

  it("422 é repassado: o problema está no que foi enviado", async () => {
    responder(() => resposta(422, { detail: "Áudio sem fala suficiente." }));

    const erro = await embedVoice(IMAGEM, "audio/webm", "modelo").catch((e: unknown) => e);

    expect(erro).toMatchObject({ status: 422 });
    expect((erro as Error).message).toBe("Áudio sem fala suficiente.");
  });

  it("413 é repassado: arquivo grande demais", async () => {
    responder(() => resposta(413, { detail: "Arquivo grande demais." }));

    await expect(embedVoice(IMAGEM, "audio/webm", "modelo")).rejects.toMatchObject({ status: 413, message: "Arquivo grande demais." });
  });

  it("500 do serviço vira 502 para quem chamou", async () => {
    responder(() => resposta(500, { detail: "onnxruntime caiu" }));

    await expect(detectGestures(IMAGEM, "image/jpeg")).rejects.toMatchObject({ status: 502, message: "onnxruntime caiu" });
  });

  it("404 também é 502 (erro dele, não do pedido)", async () => {
    responder(() => resposta(404, {}));

    await expect(detectGestures(IMAGEM, "image/jpeg")).rejects.toMatchObject({ status: 502, message: "percepção 404" });
  });

  it("erro com corpo que não é JSON ainda vira erro legível", async () => {
    responder(() => resposta(500, undefined));

    await expect(detectGestures(IMAGEM, "image/jpeg")).rejects.toMatchObject({ status: 502, message: "percepção 500" });
  });
});

describe("requisição que dá certo", () => {
  it("devolve o corpo e marca a requisição como biométrica", async () => {
    cfg.url = "http://127.0.0.1:8002/";
    responder(() => resposta(200, { ms: 3, vocabulario: ["joia"], gestos: [] }));

    const r = await detectGestures(IMAGEM, "image/png");

    expect(r.vocabulario).toEqual(["joia"]);
    // barra sobrando na configuração não pode virar "//pose/gesture"
    expect(chamadas[0]?.url).toBe("http://127.0.0.1:8002/pose/gesture");
    const headers = chamadas[0]?.init?.headers as Record<string, string>;
    expect(headers[BIOMETRIC_HEADER]).toBe("1");
    expect(chamadas[0]?.init?.body).toBeInstanceOf(FormData);
  });

  it("segredo compartilhado, quando configurado, vai no cabeçalho", async () => {
    process.env.PERCEPTION_TOKEN = "segredo-da-casa";
    responder(() => resposta(200, { ms: 1, vocabulario: [], gestos: [] }));

    await detectGestures(IMAGEM, "image/png");

    expect((chamadas[0]?.init?.headers as Record<string, string>)["x-orbita-percepcao"]).toBe("segredo-da-casa");
  });

  it("sem segredo configurado, nenhum cabeçalho vazio é inventado", async () => {
    responder(() => resposta(200, { ms: 1, vocabulario: [], gestos: [] }));

    await detectGestures(IMAGEM, "image/png");

    expect(chamadas[0]?.init?.headers).not.toHaveProperty("x-orbita-percepcao");
  });
});
