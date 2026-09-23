import { describe, expect, it } from "vitest";
import { buildCsp, hstsValue, origemDe, securityHeaders } from "./headers";

/**
 * Cabeçalhos de segurança. O risco de uma CSP é quebrar o app (voz, realtime,
 * câmera) em silêncio: estes testes fixam o que PRECISA continuar liberado.
 */

describe("CSP", () => {
  const prod = buildCsp({ dev: false, voiceWs: "ws://localhost:8001/ws/wake" });

  it("libera o que a Órbita usa de fato", () => {
    expect(prod).toContain("connect-src 'self' https://api.openai.com wss://generativelanguage.googleapis.com ws://localhost:8001");
    expect(prod).toContain("media-src 'self' data: blob:");
    expect(prod).toContain("img-src 'self' data: blob:");
  });

  it("não libera script de blob:, nem em desenvolvimento", () => {
    // O worklet de áudio do Gemini Live começou como blob e foi recusado:
    // `audioWorklet.addModule` passa por `script-src`. A saída foi servir o
    // worklet de `public/audio/captura-pcm.js`, e NÃO abrir `blob:` aqui —
    // que liberaria qualquer script montado em tempo de execução.
    expect(prod).not.toMatch(/script-src[^;]*blob:/);
    expect(buildCsp({ dev: true })).not.toMatch(/script-src[^;]*blob:/);
  });

  it("libera os DOIS provedores de voz em tempo real", () => {
    // o navegador abre a sessão direto com o provedor; sem isto no connect-src,
    // o modo de voz falha em silêncio, que é exatamente o que este arquivo evita
    expect(prod).toContain("https://api.openai.com"); // WebRTC
    expect(prod).toContain("wss://generativelanguage.googleapis.com"); // WebSocket do Gemini Live
  });

  it("fecha plugin, embutir em outro site, base e formulário", () => {
    for (const d of ["object-src 'none'", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'"]) expect(prod).toContain(d);
  });

  it("WebAssembly é permitido, em dev e em produção", () => {
    // sem isto o detector de fala (silero, em .wasm) morre calado em produção
    // e a voz cai para a energia sem ninguém entender por quê
    for (const csp of [prod, buildCsp({ dev: true })]) {
      expect(csp.split(/[\s;]+/)).toContain("'wasm-unsafe-eval'");
    }
  });

  it("eval e WebSocket livre só em desenvolvimento", () => {
    // `'unsafe-eval'` como TOKEN, não como pedaço de texto: `'wasm-unsafe-eval'`
    // contém essa sequência e é outra coisa, bem mais estreita. Comparar por
    // substring reprovaria a permissão certa e aprovaria um descuido futuro.
    expect(prod.split(/[\s;]+/)).not.toContain("'unsafe-eval'");
    expect(prod).not.toMatch(/connect-src[^;]*\bws: /);
    const dev = buildCsp({ dev: true });
    expect(dev.split(/[\s;]+/)).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
  });

  it("origem extra configurada entra; lixo é ignorado", () => {
    expect(buildCsp({ dev: false, extraConnect: "https://voz.render.com/x, isto-nao-e-url" })).toContain("https://voz.render.com");
    expect(origemDe("isto-nao-e-url")).toBeNull();
  });

  it("modo relatório e desligado", () => {
    expect(securityHeaders({ CSP_MODE: "report-only" }, false).some((h) => h.key === "Content-Security-Policy-Report-Only")).toBe(true);
    expect(securityHeaders({ CSP_MODE: "off" }, false).some((h) => h.key.startsWith("Content-Security-Policy"))).toBe(false);
  });
});

describe("HSTS", () => {
  it("só com HTTPS de verdade", () => {
    expect(hstsValue("http://localhost:3000", undefined)).toBeNull();
    expect(hstsValue(undefined, undefined)).toBeNull();
    expect(hstsValue("https://orbita.casa.com", undefined)).toBe("max-age=15552000");
  });
  it("prazo configurável, e zero desliga", () => {
    expect(hstsValue("https://orbita.casa.com", "3600")).toBe("max-age=3600");
    expect(hstsValue("https://orbita.casa.com", "0")).toBeNull();
  });
});
