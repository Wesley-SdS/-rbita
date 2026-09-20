import { EventEmitter } from "node:events";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, it, expect, vi } from "vitest";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

// `minimoParaComprimir` importa a config sob demanda; aqui fixamos o limiar.
vi.mock("@orbita/core/settings/index", () => ({
  settings: { get: vi.fn(async () => 1024) },
}));

const { sendWebResponse } = await import("./web");

/**
 * Response fake: guarda o que teria ido para o socket e, principalmente,
 * REGISTRA EM QUANTAS ESCRITAS isso aconteceu. É a única forma de afirmar que
 * o streaming continua streaming em vez de virar um buffer só.
 */
class FakeRes extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableFinished = false;
  escritas: Buffer[] = [];
  private headerMap = new Map<string, string>();

  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(k: string, v: string | number) {
    this.headerMap.set(k.toLowerCase(), String(v));
  }
  getHeader(k: string) {
    return this.headerMap.get(k.toLowerCase());
  }
  flushHeaders() {
    this.headersSent = true;
  }
  write(chunk: Buffer | string) {
    this.escritas.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }
  end(chunk?: Buffer | string) {
    if (chunk) this.write(chunk);
    this.writableFinished = true;
    this.emit("finish");
  }
  get corpo(): Buffer {
    return Buffer.concat(this.escritas);
  }
}

function fakeReq(headers: Record<string, string> = {}, method = "GET"): ExpressRequest {
  const r = new EventEmitter() as unknown as ExpressRequest;
  Object.assign(r, { method, headers: { host: "localhost:3010", ...headers }, originalUrl: "/api/x", protocol: "http" });
  return r;
}

const asRes = (r: FakeRes) => r as unknown as ExpressResponse;

/** Um corpo grande e repetitivo, como a listagem de entidades do Home Assistant. */
const grande = { entities: Array.from({ length: 300 }, (_, i) => ({ entityId: `light.sala_${i}`, domain: "light", friendlyName: "Luz da sala", roomId: null })) };

describe("sendWebResponse: streaming", () => {
  it("NDJSON sai em PEDAÇOS, sem compressão e sem Content-Length", async () => {
    // Este é o caso que não pode regredir: o chat emite token a token, e
    // qualquer buffer no meio do caminho apaga o ganho do streaming.
    const linhas = ['{"t":"text","v":"oi"}\n', '{"t":"text","v":" tudo"}\n', '{"t":"text","v":" bem"}\n'];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const l of linhas) controller.enqueue(new TextEncoder().encode(l));
        controller.close();
      },
    });
    const web = new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
    const res = new FakeRes();

    await sendWebResponse(fakeReq({ "accept-encoding": "br, gzip" }), asRes(res), web);

    expect(res.escritas).toHaveLength(3); // três escritas, não uma
    expect(res.corpo.toString()).toBe(linhas.join(""));
    expect(res.getHeader("content-encoding")).toBeUndefined();
    expect(res.getHeader("content-length")).toBeUndefined();
    expect(res.getHeader("cache-control")).toBe("no-store");
  });

  it("áudio e outros tipos também passam direto", async () => {
    const web = new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    const res = new FakeRes();
    await sendWebResponse(fakeReq({ "accept-encoding": "gzip" }), asRes(res), web);
    expect(res.getHeader("content-encoding")).toBeUndefined();
    expect(res.corpo).toEqual(Buffer.from([1, 2, 3]));
  });
});

describe("sendWebResponse: compressão de JSON", () => {
  it("comprime JSON grande com brotli e o conteúdo volta idêntico", async () => {
    const res = new FakeRes();
    await sendWebResponse(fakeReq({ "accept-encoding": "br, gzip" }), asRes(res), Response.json(grande));

    expect(res.getHeader("content-encoding")).toBe("br");
    expect(JSON.parse(brotliDecompressSync(res.corpo).toString())).toEqual(grande);
    expect(Number(res.getHeader("content-length"))).toBe(res.corpo.byteLength);
    // encolheu de verdade, não só ganhou um cabeçalho
    expect(res.corpo.byteLength).toBeLessThan(JSON.stringify(grande).length / 4);
  });

  it("usa gzip quando é só o que o cliente aceita", async () => {
    const res = new FakeRes();
    await sendWebResponse(fakeReq({ "accept-encoding": "gzip, deflate" }), asRes(res), Response.json(grande));
    expect(res.getHeader("content-encoding")).toBe("gzip");
    expect(JSON.parse(gunzipSync(res.corpo).toString())).toEqual(grande);
  });

  it("NÃO comprime JSON pequeno (o cabeçalho custaria mais que o ganho)", async () => {
    const res = new FakeRes();
    await sendWebResponse(fakeReq({ "accept-encoding": "br" }), asRes(res), Response.json({ rooms: [] }));
    expect(res.getHeader("content-encoding")).toBeUndefined();
    expect(JSON.parse(res.corpo.toString())).toEqual({ rooms: [] });
  });

  it("cliente que não aceita compressão recebe o JSON puro", async () => {
    const res = new FakeRes();
    await sendWebResponse(fakeReq({ "accept-encoding": "identity" }), asRes(res), Response.json(grande));
    expect(res.getHeader("content-encoding")).toBeUndefined();
    expect(JSON.parse(res.corpo.toString())).toEqual(grande);
  });

  it("acrescenta Accept-Encoding ao Vary SEM apagar o Cookie", async () => {
    // perder o `Vary: Cookie` faria um cache compartilhado servir a resposta
    // de um dono para outra pessoa: é o erro mais caro possível aqui
    const web = Response.json(grande, { headers: { Vary: "Cookie" } });
    const res = new FakeRes();
    await sendWebResponse(fakeReq({ "accept-encoding": "br" }), asRes(res), web);

    const vary = String(res.getHeader("vary")).toLowerCase();
    expect(vary).toContain("cookie");
    expect(vary).toContain("accept-encoding");
  });
});
