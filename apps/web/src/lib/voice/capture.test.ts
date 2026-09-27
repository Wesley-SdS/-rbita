import { describe, it, expect } from "vitest";
import { restricoesDoMicrofone, vozesEsperadas } from "./capture";

/**
 * A CAPTURA DA REUNIÃO, na parte que decide a qualidade do que chega ao STT.
 *
 * O que estes testes travam saiu de uma reunião real (26/09/2026): duas pessoas
 * na mesma sala, 22 segundos, e a transcrição voltou com UM locutor e falas
 * truncadas. As duas decisões abaixo são a correção, e as duas são fáceis de
 * reverter por engano ao mexer em `startMeetingCapture`.
 */

describe("tratamento do microfone", () => {
  it("na sala (sem áudio de tela), o microfone vai CRU", () => {
    // é o caso que estava quebrado: ganho automático nivela as duas vozes e a
    // diarização separa justamente pela diferença entre elas
    const r = restricoesDoMicrofone("auto", false);
    expect(r.echoCancellation).toBe(false);
    expect(r.noiseSuppression).toBe(false);
    expect(r.autoGainControl).toBe(false);
  });

  it("com áudio de tela, o tratamento volta: o eco existe de verdade", () => {
    // a voz dos outros sai pela caixa de som e entraria duas vezes
    const r = restricoesDoMicrofone("auto", true);
    expect(r.echoCancellation).toBe(true);
    expect(r.noiseSuppression).toBe(true);
    expect(r.autoGainControl).toBe(true);
  });

  it("a escolha do dono vence o automático, nos dois sentidos", () => {
    expect(restricoesDoMicrofone("nunca", true).echoCancellation).toBe(false);
    expect(restricoesDoMicrofone("sempre", false).echoCancellation).toBe(true);
  });
});

describe("quantas vozes esperar", () => {
  it("aceita a faixa que a separação entende (2 a 10)", () => {
    expect(vozesEsperadas("2")).toBe(2);
    expect(vozesEsperadas(" 3 ")).toBe(3);
    expect(vozesEsperadas("10")).toBe(10);
  });

  it("vazio, zero, um e fora da faixa viram “não sei”", () => {
    // mandar um número inventado atrapalha mais que a ausência dele
    expect(vozesEsperadas("")).toBe(0);
    expect(vozesEsperadas("   ")).toBe(0);
    expect(vozesEsperadas("1")).toBe(0);
    expect(vozesEsperadas("0")).toBe(0);
    expect(vozesEsperadas("11")).toBe(0);
    expect(vozesEsperadas("-2")).toBe(0);
  });

  it("texto e número quebrado não passam", () => {
    expect(vozesEsperadas("duas")).toBe(0);
    expect(vozesEsperadas("2.5")).toBe(0);
  });
});
