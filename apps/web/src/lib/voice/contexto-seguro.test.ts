import { describe, expect, it } from "vitest";
import { diagnosticarVoz, type JanelaSuficiente } from "./contexto-seguro";

/**
 * Por que a voz não funciona no celular.
 *
 * O navegador só entrega microfone em contexto seguro. Acessando a Órbita de
 * outro aparelho da casa por `http://192.168.x.x:3000`, `mediaDevices` não
 * existe e o código estoura sem explicar nada. O que este arquivo trava é a
 * EXPLICAÇÃO: uma falha muda de "a Órbita está quebrada" para "falta HTTPS"
 * só porque alguém disse a frase certa.
 */

const janela = (over: Partial<JanelaSuficiente> = {}): JanelaSuficiente => ({
  location: { protocol: "https:", hostname: "casa.local", port: "3000" },
  navigator: { mediaDevices: {}, wakeLock: {} },
  ...over,
});

describe("o diagnóstico da voz", () => {
  it("HTTPS com microfone: tudo liberado e nada a dizer", () => {
    const d = diagnosticarVoz(janela({ isSecureContext: true }));
    expect(d).toMatchObject({ podeGravar: true, podeSegurarTela: true, motivo: null });
  });

  it("localhost vale como seguro mesmo em HTTP", () => {
    // é como o dono usa no próprio computador, e funciona
    const d = diagnosticarVoz(janela({ location: { protocol: "http:", hostname: "localhost", port: "3000" } }));
    expect(d.podeGravar).toBe(true);
  });

  it("IP da rede por HTTP: explica e sugere o computador", () => {
    // o caso real: o celular na cozinha, em http://192.168.15.8:3000
    const d = diagnosticarVoz({
      isSecureContext: false,
      location: { protocol: "http:", hostname: "192.168.15.8", port: "3000" },
      navigator: {},
    });
    expect(d.podeGravar).toBe(false);
    expect(d.podeSegurarTela).toBe(false);
    expect(d.motivo).toMatch(/HTTPS/);
    expect(d.sugestao).toBe("http://localhost:3000");
  });

  it("contexto inseguro explica TUDO: não manda procurar no navegador errado", () => {
    // dizer "seu navegador não suporta microfone" para quem só está em HTTP
    // faria a pessoa trocar de navegador sem resolver nada
    const d = diagnosticarVoz({
      isSecureContext: false,
      location: { protocol: "http:", hostname: "192.168.15.8" },
      navigator: { mediaDevices: {}, wakeLock: {} },
    });
    expect(d.motivo).toMatch(/HTTPS|seguro/);
    expect(d.motivo).not.toMatch(/navegador não dá acesso/);
  });

  it("seguro mas sem microfone: aí sim é o navegador", () => {
    const d = diagnosticarVoz(janela({ isSecureContext: true, navigator: { wakeLock: {} } }));
    expect(d.podeGravar).toBe(false);
    expect(d.motivo).toMatch(/navegador/);
    // e ainda assim o satélite pode segurar a tela
    expect(d.podeSegurarTela).toBe(true);
  });

  it("sem Wake Lock, a voz funciona mas o satélite não segura a tela", () => {
    const d = diagnosticarVoz(janela({ isSecureContext: true, navigator: { mediaDevices: {} } }));
    expect(d.podeGravar).toBe(true);
    expect(d.podeSegurarTela).toBe(false);
  });

  it("sem `isSecureContext`, decide pelo protocolo", () => {
    // navegadores antigos não expõem a propriedade
    expect(diagnosticarVoz(janela({ location: { protocol: "https:", hostname: "x.com" } })).podeGravar).toBe(true);
    expect(
      diagnosticarVoz({ location: { protocol: "http:", hostname: "192.168.0.9" }, navigator: { mediaDevices: {} } }).podeGravar,
    ).toBe(false);
  });

  it("o navegador tem a palavra final sobre ser seguro", () => {
    // `isSecureContext` é o que o próprio navegador afirma. Quando ele diz que
    // NÃO é seguro, isso vale mesmo em localhost (acontece dentro de iframe
    // sem permissão, por exemplo), e insistir no palpite pelo hostname faria a
    // Órbita prometer um microfone que não vai receber.
    const d = diagnosticarVoz({
      isSecureContext: false,
      location: { protocol: "http:", hostname: "localhost", port: "3000" },
      navigator: {},
    });
    expect(d.podeGravar).toBe(false);
    // e não manda a pessoa para o mesmo endereço em que ela já está
    expect(d.sugestao).toBeUndefined();
  });
});
