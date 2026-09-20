import { describe, expect, it, vi } from "vitest";

// A config vem do banco; aqui só interessa o comportamento do cabeçalho.
vi.mock("@orbita/core/settings/index", () => ({
  settings: { get: vi.fn(async () => 30) },
}));

const { casaComEtag, etagDe, leituraCacheavel } = await import("./cacheable");

const pedido = (ifNoneMatch?: string) =>
  new Request("http://localhost/api/home/rooms", { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} });

describe("etagDe", () => {
  it("é estável para o mesmo corpo e diferente para corpos diferentes", () => {
    expect(etagDe('{"a":1}')).toBe(etagDe('{"a":1}'));
    expect(etagDe('{"a":1}')).not.toBe(etagDe('{"a":2}'));
  });

  it("vem entre aspas, como manda o HTTP", () => {
    expect(etagDe("x")).toMatch(/^".+"$/);
  });
});

describe("casaComEtag", () => {
  const etag = '"abc"';

  it("sem cabeçalho, não casa", () => {
    expect(casaComEtag(null, etag)).toBe(false);
  });

  it("casa com o valor exato", () => {
    expect(casaComEtag('"abc"', etag)).toBe(true);
  });

  it("casa com validador fraco (proxy que comprime acrescenta W/)", () => {
    expect(casaComEtag('W/"abc"', etag)).toBe(true);
  });

  it("casa dentro de uma lista", () => {
    expect(casaComEtag('"zzz", W/"abc" , "yyy"', etag)).toBe(true);
  });

  it("casa com o coringa", () => {
    expect(casaComEtag("*", etag)).toBe(true);
  });

  it("não casa com outro ETag", () => {
    expect(casaComEtag('"outro"', etag)).toBe(false);
  });
});

describe("leituraCacheavel", () => {
  it("200 com corpo, ETag e Cache-Control privado", async () => {
    const r = await leituraCacheavel(pedido(), { rooms: [] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ rooms: [] });
    expect(r.headers.get("etag")).toBeTruthy();
    expect(r.headers.get("cache-control")).toContain("private");
    expect(r.headers.get("cache-control")).toContain("max-age=30");
    // resposta do dono nunca pode encostar num cache compartilhado
    expect(r.headers.get("vary")).toBe("Cookie");
  });

  it("304 sem corpo quando o navegador já tem a versão atual", async () => {
    const dados = { rooms: [{ id: "1" }] };
    const primeira = await leituraCacheavel(pedido(), dados);
    const etag = primeira.headers.get("etag")!;

    const segunda = await leituraCacheavel(pedido(etag), dados);
    expect(segunda.status).toBe(304);
    expect(segunda.body).toBeNull();
    expect(segunda.headers.get("etag")).toBe(etag);
  });

  it("200 de novo quando o dado mudou, mesmo com If-None-Match", async () => {
    const etagVelho = (await leituraCacheavel(pedido(), { rooms: [] })).headers.get("etag")!;
    const r = await leituraCacheavel(pedido(etagVelho), { rooms: [{ id: "novo" }] });
    expect(r.status).toBe(200);
  });

  it("maxAge zero mantém a revalidação por ETag, sem reuso cego", async () => {
    const r = await leituraCacheavel(pedido(), { a: 1 }, { maxAgeS: 0 });
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect(r.headers.get("etag")).toBeTruthy();
  });
});
