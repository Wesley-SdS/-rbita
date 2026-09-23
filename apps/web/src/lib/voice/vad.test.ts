import { describe, expect, it } from "vitest";
import { DetectorDeFala, EnergiaAdaptativa, LIMIARES_PADRAO } from "./vad";

/**
 * A decisão de quando a pessoa começou e parou de falar.
 *
 * O detector antigo era `rms > 0.02`: cortava quem fala baixo e nunca parava
 * com ventilador ligado. O que este arquivo trava são as duas decisões que
 * fazem a diferença entre "funciona no silêncio" e "funciona na cozinha":
 * a histerese (dois limiares) e o piso de ruído aprendido.
 */

/** Roda uma sequência de quadros de 100 ms e devolve o estado final. */
function rodar(probs: number[], lim = LIMIARES_PADRAO, passo = 100) {
  const d = new DetectorDeFala(lim, 0);
  let estado = d.alimentar(0, 0);
  probs.forEach((p, i) => {
    estado = d.alimentar(p, (i + 1) * passo);
  });
  return { estado, detector: d };
}

describe("a máquina de estados da fala", () => {
  it("silêncio puro não começa nada", () => {
    const { estado, detector } = rodar([0, 0, 0, 0, 0]);
    expect(estado).toBe("esperando");
    expect(detector.houveFala).toBe(false);
  });

  it("fala seguida vira falando e, depois do silêncio, termina", () => {
    const fala = Array(8).fill(0.9);
    const silencio = Array(15).fill(0.02);
    const { estado, detector } = rodar([...fala, ...silencio]);
    expect(estado).toBe("terminou");
    expect(detector.houveFala).toBe(true);
  });

  it("HISTERESE: probabilidade oscilando em volta do limiar não pica a fala", () => {
    // com um limiar só, 0.45 encerraria a fala no meio e a Órbita responderia
    // a meia frase. Com dois, 0.45 ainda é "continua falando".
    const oscilando = [0.9, 0.45, 0.8, 0.42, 0.95, 0.4, 0.9];
    const { estado } = rodar(oscilando);
    expect(estado).toBe("falando");
  });

  it("mas cair de verdade encerra", () => {
    const { estado } = rodar([0.9, 0.9, 0.9, ...Array(15).fill(0.2)]);
    expect(estado).toBe("terminou");
  });

  it("estalo curto NÃO acorda a captura", () => {
    // uma porta batendo dá um quadro alto; exigir duração é o que separa isso
    // de alguém começando a falar
    const { estado, detector } = rodar([0.95, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    expect(estado).toBe("esperando");
    expect(detector.houveFala).toBe(false);
  });

  it("o teto de tempo encerra mesmo com a pessoa ainda falando", () => {
    const lim = { ...LIMIARES_PADRAO, maxMs: 500 };
    const { estado } = rodar(Array(10).fill(0.9), lim);
    expect(estado).toBe("estourou");
  });

  it("depois de decidido, não muda mais de ideia", () => {
    const d = new DetectorDeFala(LIMIARES_PADRAO, 0);
    for (let i = 1; i <= 8; i++) d.alimentar(0.9, i * 100);
    for (let i = 9; i <= 25; i++) d.alimentar(0.01, i * 100);
    expect(d.alimentar(0.99, 2700)).toBe("terminou");
  });

  it("silêncio configurável: quem fala pausado ganha mais tempo", () => {
    const paciente = { ...LIMIARES_PADRAO, silencioMs: 3000 };
    const fala = Array(4).fill(0.9);
    const pausa = Array(15).fill(0.05); // 1,5 s
    expect(rodar([...fala, ...pausa]).estado).toBe("terminou");
    expect(rodar([...fala, ...pausa], paciente).estado).toBe("falando");
  });
});

describe("a energia com piso de ruído aprendido", () => {
  it("num ambiente silencioso, fala normal passa", () => {
    const e = new EnergiaAdaptativa(3);
    for (let i = 0; i < 3; i++) e.prob(0.001); // calibra no silêncio
    expect(e.prob(0.05)).toBeGreaterThan(0.5);
  });

  it("VENTILADOR: ruído constante vira piso e deixa de ser fala", () => {
    // é o caso que travava a Órbita para sempre com o limiar fixo de 0,02
    const e = new EnergiaAdaptativa(3);
    for (let i = 0; i < 3; i++) e.prob(0.03); // exaustor ligado desde o começo
    expect(e.prob(0.03)).toBe(0);
    // e a voz por cima do ruído ainda é reconhecida
    expect(e.prob(0.2)).toBeGreaterThan(0.5);
  });

  it("FALA BAIXA num quarto quieto é ouvida", () => {
    // 0,012 não passaria do limiar fixo de 0,02 e a pessoa não era ouvida
    const e = new EnergiaAdaptativa(3);
    for (let i = 0; i < 3; i++) e.prob(0.0008);
    expect(e.prob(0.012)).toBeGreaterThan(0);
  });

  it("durante a calibragem não decide nada", () => {
    const e = new EnergiaAdaptativa(3);
    expect(e.prob(0.9)).toBe(0);
    expect(e.prob(0.9)).toBe(0);
  });

  it("o piso pega o MAIOR dos primeiros quadros, não a média", () => {
    // um ruído intermitente (geladeira que liga) ficaria acima de uma média
    const e = new EnergiaAdaptativa(3);
    e.prob(0.001);
    e.prob(0.04);
    e.prob(0.001);
    expect(e.pisoDeRuido).toBeCloseTo(0.04, 3);
    expect(e.prob(0.04)).toBe(0);
  });

  it("silêncio absoluto não transforma sussurro em fala", () => {
    const e = new EnergiaAdaptativa(3);
    for (let i = 0; i < 3; i++) e.prob(0);
    expect(e.prob(0.002)).toBe(0);
  });
});

describe("energia e detector juntos", () => {
  it("cozinha com exaustor: só a voz encerra a captura", () => {
    const e = new EnergiaAdaptativa(3);
    const d = new DetectorDeFala(LIMIARES_PADRAO, 0);
    const quadro = (rms: number, t: number) => d.alimentar(e.prob(rms), t);

    let t = 0;
    for (let i = 0; i < 3; i++) quadro(0.03, (t += 100)); // calibra com o exaustor
    for (let i = 0; i < 5; i++) expect(quadro(0.03, (t += 100))).toBe("esperando"); // só exaustor
    for (let i = 0; i < 6; i++) quadro(0.25, (t += 100)); // a pessoa fala
    expect(d.houveFala).toBe(true);
    for (let i = 0; i < 15; i++) quadro(0.03, (t += 100)); // volta só o exaustor
    expect(quadro(0.03, (t += 100))).toBe("terminou");
  });
});
