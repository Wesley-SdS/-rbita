import { describe, expect, it } from "vitest";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { codificacaoAceita, comprimir, deveComprimir } from "./compress";

const base = {
  metodo: "GET",
  status: 200,
  contentType: "application/json; charset=utf-8",
  contentEncoding: null as string | null,
  tamanhoBytes: 5000,
  minimoBytes: 1024,
};

describe("codificacaoAceita", () => {
  it("sem cabeçalho, não comprime", () => {
    expect(codificacaoAceita(null)).toBeNull();
    expect(codificacaoAceita("")).toBeNull();
  });

  it("prefere brotli quando os dois são aceitos", () => {
    expect(codificacaoAceita("gzip, deflate, br")).toBe("br");
  });

  it("cai para gzip quando brotli não é oferecido", () => {
    expect(codificacaoAceita("gzip, deflate")).toBe("gzip");
  });

  it("o coringa vale por qualquer uma", () => {
    expect(codificacaoAceita("*")).toBe("br");
  });

  it("respeita q=0 (cliente pedindo para não comprimir)", () => {
    expect(codificacaoAceita("gzip;q=0")).toBeNull();
    expect(codificacaoAceita("br;q=0, gzip;q=1")).toBe("gzip");
  });

  it("identity sozinho não é compressão", () => {
    expect(codificacaoAceita("identity")).toBeNull();
  });
});

describe("deveComprimir", () => {
  it("comprime JSON grande o bastante", () => {
    expect(deveComprimir(base)).toBe(true);
  });

  it("NUNCA comprime o NDJSON do chat", () => {
    // o streaming token a token é a razão de existir desta guarda
    expect(deveComprimir({ ...base, contentType: "application/x-ndjson" })).toBe(false);
  });

  it("não comprime áudio nem outros tipos", () => {
    expect(deveComprimir({ ...base, contentType: "audio/mpeg" })).toBe(false);
    expect(deveComprimir({ ...base, contentType: "text/event-stream" })).toBe(false);
    expect(deveComprimir({ ...base, contentType: null })).toBe(false);
  });

  it("não comprime abaixo do mínimo", () => {
    expect(deveComprimir({ ...base, tamanhoBytes: 300 })).toBe(false);
    expect(deveComprimir({ ...base, tamanhoBytes: 1024 })).toBe(true);
  });

  it("não comprime de novo o que já veio comprimido", () => {
    expect(deveComprimir({ ...base, contentEncoding: "gzip" })).toBe(false);
  });

  it("não comprime resposta sem corpo", () => {
    expect(deveComprimir({ ...base, status: 304 })).toBe(false);
    expect(deveComprimir({ ...base, status: 204 })).toBe(false);
    expect(deveComprimir({ ...base, metodo: "HEAD" })).toBe(false);
  });
});

describe("comprimir", () => {
  const json = Buffer.from(JSON.stringify({ entities: Array.from({ length: 200 }, (_, i) => ({ entityId: `light.sala_${i}`, domain: "light", friendlyName: "Luz da sala", roomId: null })) }));

  it("gzip vai e volta igual, e encolhe muito", async () => {
    const pacote = await comprimir(json, "gzip");
    expect(gunzipSync(pacote).toString()).toBe(json.toString());
    expect(pacote.byteLength).toBeLessThan(json.byteLength / 4);
  });

  it("brotli vai e volta igual, e encolhe muito", async () => {
    const pacote = await comprimir(json, "br");
    expect(brotliDecompressSync(pacote).toString()).toBe(json.toString());
    expect(pacote.byteLength).toBeLessThan(json.byteLength / 4);
  });
});
