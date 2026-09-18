import { describe, expect, it } from "vitest";
import { motivoRecusaOrigem } from "./csrf";

/**
 * Anti-CSRF das rotas que alteram dados. O que precisa passar: o próprio app,
 * o app mobile, o webhook da câmera. O que não pode: outro site usando o
 * cookie do dono.
 */

const confiaveis = ["http://localhost:3000", "https://orbita.casa.com"];
const pedido = (over: Partial<Parameters<typeof motivoRecusaOrigem>[0]>) => ({ method: "POST", origin: null, secFetchSite: null, confiaveis, ...over });

describe("pedidos que alteram dados", () => {
  it("o próprio app passa", () => {
    expect(motivoRecusaOrigem(pedido({ origin: "http://localhost:3000", secFetchSite: "same-origin" }))).toBeNull();
    expect(motivoRecusaOrigem(pedido({ origin: "https://orbita.casa.com/", secFetchSite: "same-origin" }))).toBeNull();
  });

  it("outro site é recusado, pelo Sec-Fetch-Site ou pela origem", () => {
    expect(motivoRecusaOrigem(pedido({ origin: "https://site-malicioso.com", secFetchSite: "cross-site" }))).not.toBeNull();
    expect(motivoRecusaOrigem(pedido({ origin: "https://site-malicioso.com" }))).not.toBeNull();
    // mesmo sem Origin: o navegador sempre diz que é outro site
    expect(motivoRecusaOrigem(pedido({ secFetchSite: "cross-site" }))).not.toBeNull();
  });

  it("app mobile, webhook da câmera e script (sem cabeçalho de navegador) passam", () => {
    expect(motivoRecusaOrigem(pedido({}))).toBeNull();
    expect(motivoRecusaOrigem(pedido({ origin: "null" }))).toBeNull();
  });

  it("origem nula vinda de navegador (iframe isolado) é recusada", () => {
    expect(motivoRecusaOrigem(pedido({ origin: "null", secFetchSite: "cross-site" }))).not.toBeNull();
    expect(motivoRecusaOrigem(pedido({ origin: "null", secFetchSite: "same-site" }))).not.toBeNull();
  });
});

describe("leitura não é checada", () => {
  it("GET de outro site passa (não altera nada, e a rota exige sessão)", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(motivoRecusaOrigem(pedido({ method, origin: "https://site-malicioso.com", secFetchSite: "cross-site" }))).toBeNull();
    }
  });
});
