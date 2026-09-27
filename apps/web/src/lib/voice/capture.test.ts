import { describe, it, expect, vi, afterEach } from "vitest";
import { audioEfetivo, restricoesDoMicrofone, startMeetingCapture, vozesEsperadas } from "./capture";

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

  it("isolamento de voz fica desligado SEMPRE, até com tratamento ligado", () => {
    // ele isola a voz principal e descarta o resto: numa reunião, apaga
    // justamente a segunda pessoa
    const comTratamento = restricoesDoMicrofone("sempre", true) as { voiceIsolation?: boolean };
    const semTratamento = restricoesDoMicrofone("nunca", false) as { voiceIsolation?: boolean };
    expect(comTratamento.voiceIsolation).toBe(false);
    expect(semTratamento.voiceIsolation).toBe(false);
  });
});

describe("medição do que o microfone fez", () => {
  it("lê da trilha o que valeu de verdade", () => {
    // é esta medição que separa "pedi cru" de "gravou cru"
    const track = {
      getSettings: () => ({ echoCancellation: true, noiseSuppression: false, autoGainControl: true, sampleRate: 48000, channelCount: 1 }),
    } as unknown as MediaStreamTrack;
    expect(audioEfetivo(track)).toEqual({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
    });
  });

  it("sem trilha, devolve vazio em vez de quebrar", () => {
    expect(audioEfetivo(undefined)).toEqual({});
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

/**
 * A TRILHA TEM DE NASCER CRUA, e este é o teste que faltava.
 *
 * A primeira tentativa de corrigir o tratamento foi `applyConstraints` numa
 * trilha já viva. Ela falhou EM SILÊNCIO: o Chrome aceita a chamada, não lança
 * nada, e `getSettings()` continua com os valores antigos, porque a cadeia de
 * processamento é montada quando a trilha nasce. Só apareceu porque a medição
 * vai para o log (`comAudioDeTela: false` com `echoCancellation: true` na mesma
 * linha, 26/09/2026). A correção é reabrir o microfone.
 */
function trilhaFalsa(settings: Record<string, unknown>) {
  return { getSettings: () => settings, stop: vi.fn() } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
}

function streamFalso(track: MediaStreamTrack) {
  return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

function comMediaDevices(getUserMedia: (c: unknown) => Promise<MediaStream>) {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

afterEach(() => vi.unstubAllGlobals());

describe("microfone na reunião de sala", () => {
  it("navegador que IGNORA a restrição faz a trilha ser reaberta", async () => {
    const tratada = trilhaFalsa({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 });
    const crua = trilhaFalsa({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000, channelCount: 1 });
    const pedidos: unknown[] = [];
    comMediaDevices(async (c) => {
      pedidos.push(c);
      return streamFalso(pedidos.length === 1 ? tratada : crua);
    });

    const captura = await startMeetingCapture({ systemAudio: false, microfone: "auto" });

    expect(pedidos).toHaveLength(2); // abriu de novo em vez de aceitar o tratado
    expect(captura.audio.echoCancellation).toBe(false);
    expect(captura.audio.autoGainControl).toBe(false);
    expect(tratada.stop).toHaveBeenCalled(); // a trilha velha não fica viva
  });

  it("quando já nasce como pedido, não reabre à toa", async () => {
    const crua = trilhaFalsa({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    const pedidos: unknown[] = [];
    comMediaDevices(async (c) => {
      pedidos.push(c);
      return streamFalso(crua);
    });

    const captura = await startMeetingCapture({ systemAudio: false, microfone: "auto" });

    expect(pedidos).toHaveLength(1);
    expect(captura.audio.echoCancellation).toBe(false);
    expect(crua.stop).not.toHaveBeenCalled();
  });

  it("se reabrir falhar, segue com o que tem e a medição conta a verdade", async () => {
    // pior que gravar tratado é não gravar nada
    const tratada = trilhaFalsa({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    let primeira = true;
    comMediaDevices(async () => {
      if (primeira) {
        primeira = false;
        return streamFalso(tratada);
      }
      throw new Error("aparelho ocupado");
    });

    const captura = await startMeetingCapture({ systemAudio: false, microfone: "auto" });

    expect(captura.stream).toBeDefined();
    expect(captura.audio.echoCancellation).toBe(true); // não promete o que não houve
    expect(tratada.stop).not.toHaveBeenCalled();
  });
});
