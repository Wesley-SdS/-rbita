import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

// `bridge()` resolve a sessão via Better Auth antes de tocar na rota; mockamos
// para testar só a ponte Express ⇄ Web, sem depender de Postgres no ar.
vi.mock("@orbita/core/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@orbita/core/auth";
import { bridge } from "./bridge";

const getSessionMock = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;

/** Request fake mínimo: só o que `toWebRequest` (web.ts) realmente lê. */
class FakeReq extends EventEmitter {
  method: string;
  headers: Record<string, string | string[]>;
  originalUrl: string;
  path: string;
  protocol = "http";
  body: unknown;
  readableEnded: boolean;
  params: Record<string, string>;

  constructor(opts: {
    method: string;
    originalUrl: string;
    headers?: Record<string, string | string[]>;
    body?: unknown;
    readableEnded?: boolean;
    params?: Record<string, string>;
  }) {
    super();
    this.method = opts.method;
    this.originalUrl = opts.originalUrl;
    this.path = opts.originalUrl.split("?")[0];
    this.headers = opts.headers ?? { host: "localhost:3010" };
    this.body = opts.body;
    this.readableEnded = opts.readableEnded ?? true;
    this.params = opts.params ?? {};
  }
}

/**
 * Response fake mínima: acumula o que `sendWebResponse` escreveria no socket
 * real, e deixa `writeImpl` ser trocado por teste para simular backpressure.
 */
class FakeRes extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableFinished = false;
  chunks: Buffer[] = [];
  writeImpl?: (chunk: Buffer) => boolean;
  private headerMap = new Map<string, string>();

  status(code: number) {
    this.statusCode = code;
    this.headersSent = true;
    return this;
  }
  setHeader(k: string, v: string) {
    this.headerMap.set(k.toLowerCase(), v);
  }
  getHeader(k: string) {
    return this.headerMap.get(k.toLowerCase());
  }
  flushHeaders() {
    this.headersSent = true;
  }
  write(chunk: Buffer | string) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.writeImpl) return this.writeImpl(buf);
    this.chunks.push(buf);
    return true;
  }
  end(chunk?: Buffer | string) {
    if (chunk) this.write(chunk);
    this.writableFinished = true;
    this.emit("finish");
  }
  json(body: unknown) {
    this.setHeader("content-type", "application/json");
    this.write(JSON.stringify(body));
    this.end();
  }
}

const asExpressReq = (r: FakeReq) => r as unknown as ExpressRequest;
const asExpressRes = (r: FakeRes) => r as unknown as ExpressResponse;

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue(null);
});

describe("bridge", () => {
  it("entrega método, headers e corpo JSON ao handler, e mapeia a sessão para ctx.user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1", email: "u1@x.com", name: "Usuário Um" } });
    const req = new FakeReq({
      method: "POST",
      originalUrl: "/api/foo?x=1",
      headers: { "content-type": "application/json", "x-custom": "abc", host: "localhost:3010" },
      body: { a: 1 },
      params: { id: "42" },
    });
    const res = new FakeRes();
    let captured: { req: Request; ctx: { params: Record<string, string>; user: unknown } } | null = null;
    const handler = vi.fn(async (r: Request, ctx: { params: Record<string, string>; user: unknown }) => {
      captured = { req: r, ctx };
      return Response.json({ ok: true });
    });

    await bridge(asExpressReq(req), asExpressRes(res), handler);

    expect(captured).not.toBeNull();
    expect(captured!.req.method).toBe("POST");
    expect(captured!.req.headers.get("content-type")).toBe("application/json");
    expect(captured!.req.headers.get("x-custom")).toBe("abc");
    await expect(captured!.req.json()).resolves.toEqual({ a: 1 });
    expect(captured!.ctx.params).toEqual({ id: "42" });
    expect(captured!.ctx.user).toEqual({ id: "u1", email: "u1@x.com", name: "Usuário Um" });
  });

  it("sem sessão, ctx.user chega null ao handler", async () => {
    getSessionMock.mockResolvedValue(null);
    const req = new FakeReq({ method: "GET", originalUrl: "/api/foo" });
    const res = new FakeRes();
    let capturedUser: unknown = "não chamado";
    const handler = vi.fn(async (_r: Request, ctx: { user: unknown }) => {
      capturedUser = ctx.user;
      return new Response(null, { status: 204 });
    });

    await bridge(asExpressReq(req), asExpressRes(res), handler);

    expect(capturedUser).toBeNull();
  });

  it("requisição GET não carrega corpo no Request repassado", async () => {
    const req = new FakeReq({ method: "GET", originalUrl: "/api/foo" });
    const res = new FakeRes();
    let captured: Request | null = null;
    const handler = vi.fn(async (r: Request) => {
      captured = r;
      return new Response(null, { status: 200 });
    });

    await bridge(asExpressReq(req), asExpressRes(res), handler);

    expect(captured!.body).toBeNull();
  });

  it("devolve status, headers e corpo do Response para o Express", async () => {
    const req = new FakeReq({ method: "POST", originalUrl: "/api/foo" });
    const res = new FakeRes();
    const handler = vi.fn(async () => Response.json({ ok: true }, { status: 201, headers: { "x-reply": "sim" } }));

    await bridge(asExpressReq(req), asExpressRes(res), handler);

    expect(res.statusCode).toBe(201);
    expect(res.getHeader("x-reply")).toBe("sim");
    expect(Buffer.concat(res.chunks).toString()).toBe(JSON.stringify({ ok: true }));
    expect(res.writableFinished).toBe(true);
  });

  it("não repassa content-length do Response (o Node recalcula)", async () => {
    const req = new FakeReq({ method: "GET", originalUrl: "/api/foo" });
    const res = new FakeRes();
    const handler = vi.fn(async () => new Response("olá", { status: 200, headers: { "content-length": "999" } }));

    await bridge(asExpressReq(req), asExpressRes(res), handler);

    expect(res.getHeader("content-length")).toBeUndefined();
  });

  it("escreve os chunks do ReadableStream na ordem em que chegam", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("um "));
        controller.enqueue(new TextEncoder().encode("dois "));
        controller.enqueue(new TextEncoder().encode("três"));
        controller.close();
      },
    });
    const req = new FakeReq({ method: "GET", originalUrl: "/api/stream" });
    const res = new FakeRes();
    const handler = vi.fn(async () => new Response(stream, { status: 200 }));

    await bridge(asExpressReq(req), asExpressRes(res), handler);

    expect(res.chunks.map((c) => c.toString())).toEqual(["um ", "dois ", "três"]);
    expect(res.writableFinished).toBe(true);
  });

  it("espera o drain antes de escrever o próximo chunk quando o socket enche", async () => {
    const order: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a"));
        controller.enqueue(new TextEncoder().encode("b"));
        controller.close();
      },
    });
    const req = new FakeReq({ method: "GET", originalUrl: "/api/stream" });
    const res = new FakeRes();
    res.writeImpl = (buf) => {
      order.push(buf.toString());
      return order.length !== 1; // primeiro chunk simula socket cheio
    };
    const handler = vi.fn(async () => new Response(stream, { status: 200 }));

    const promise = bridge(asExpressReq(req), asExpressRes(res), handler);
    // dá tempo do laço escrever o primeiro chunk e ficar parado esperando o drain
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(["a"]); // ainda não escreveu o segundo: está esperando

    res.emit("drain");
    await promise;

    expect(order).toEqual(["a", "b"]);
  });

  it("aborta o AbortSignal do Request quando o cliente desconecta antes do fim (close do res)", async () => {
    const req = new FakeReq({ method: "GET", originalUrl: "/api/lento" });
    const res = new FakeRes();
    let captured: Request | null = null;
    let resolveHandler!: (r: Response) => void;
    const handler = vi.fn((r: Request) => {
      captured = r;
      return new Promise<Response>((resolve) => {
        resolveHandler = resolve;
      });
    });

    const promise = bridge(asExpressReq(req), asExpressRes(res), handler);
    // deixa a sessão (mock) resolver e o handler ser chamado antes de mexer no res
    await new Promise((r) => setImmediate(r));
    expect(captured).not.toBeNull();
    expect(captured!.signal.aborted).toBe(false);

    res.emit("close"); // cliente foi embora (botão parar, barge-in do TTS)
    expect(captured!.signal.aborted).toBe(true);

    resolveHandler(new Response(null, { status: 200 }));
    await promise;
  });

  it("não aborta quando o close chega depois da resposta já ter terminado", async () => {
    const req = new FakeReq({ method: "GET", originalUrl: "/api/rapido" });
    const res = new FakeRes();
    let captured: Request | null = null;
    const handler = vi.fn(async (r: Request) => {
      captured = r;
      return new Response("ok", { status: 200 });
    });

    await bridge(asExpressReq(req), asExpressRes(res), handler);
    expect(res.writableFinished).toBe(true);

    res.emit("close"); // close normal da conexão após o end()

    expect(captured!.signal.aborted).toBe(false);
  });

  it("handler lançando erro vira 500 com corpo padrão, sem derrubar o processo", async () => {
    const req = new FakeReq({ method: "GET", originalUrl: "/api/quebra" });
    const res = new FakeRes();
    const handler = vi.fn(async () => {
      throw new Error("falhou");
    });

    await bridge(asExpressReq(req), asExpressRes(res), handler);

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(Buffer.concat(res.chunks).toString())).toEqual({ error: "Erro interno" });
  });
});
