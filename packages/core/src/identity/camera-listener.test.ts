import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const cfg = vi.hoisted(() => ({ minIntervalSeconds: 5, labels: ["person", "pessoa"] }));

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("./face", () => ({ identifyCameraEvent: vi.fn() }));
vi.mock("./gesture", () => ({ detectGestureForEvent: vi.fn() }));
vi.mock("../settings", () => ({
  settings: {
    get: async () => "",
    getMany: async () => ({ "identity.identifyMinIntervalSeconds": cfg.minIntervalSeconds, "identity.identifyLabels": cfg.labels }),
  },
}));
// bus de verdade (sem outbox: `db` aqui é um dublê vazio), para o teste passar
// pelo mesmo caminho do processo vivo: emitir o evento, não chamar o listener
vi.mock("../events/index", async () => {
  const { createEventBus } = await vi.importActual<typeof import("../events/bus")>("../events/bus");
  return { events: createEventBus({ source: "teste" }) };
});

import { events } from "../events/index";
import { identifyCameraEvent } from "./face";
import { detectGestureForEvent } from "./gesture";
import { _resetCameraIdentityState, installCameraIdentityListener, shouldIdentify } from "./camera-listener";

/**
 * Freio da rajada: o Frigate manda vários eventos por segundo quando alguém
 * atravessa o campo de visão, e nesta máquina o reconhecimento é CPU.
 */
describe("quando vale identificar num evento de câmera", () => {
  const agora = 1_000_000;
  const labels = ["person", "pessoa"];

  it("rótulo com gente e sem evento recente: identifica", () => {
    expect(shouldIdentify("person", "cam1", agora, undefined, 5, labels)).toBe(true);
    expect(shouldIdentify("Pessoa", "cam1", agora, undefined, 5, labels)).toBe(true);
  });

  it("carro e movimento não acionam visão à toa", () => {
    expect(shouldIdentify("car", "cam1", agora, undefined, 5, labels)).toBe(false);
    expect(shouldIdentify("motion", "cam1", agora, undefined, 5, labels)).toBe(false);
  });

  it("respeita o intervalo mínimo por câmera", () => {
    expect(shouldIdentify("person", "cam1", agora, agora - 2000, 5, labels)).toBe(false);
    expect(shouldIdentify("person", "cam1", agora, agora - 6000, 5, labels)).toBe(true);
  });

  it("lista de rótulos vazia aceita qualquer coisa (o dono decide)", () => {
    expect(shouldIdentify("car", "cam1", agora, undefined, 5, [])).toBe(true);
  });
});

/**
 * O listener de verdade, pelo caminho do processo vivo: quem dispara é o EVENTO
 * `camera.detected` (a cerca do NV.1 depende disso, `cameras/ingest.ts` não pode
 * importar biometria). É aqui que o freio de rajada deixa de ser função pura e
 * vira comportamento.
 */
describe("listener de câmera", () => {
  const detectado = (over: Record<string, unknown> = {}) => ({
    eventId: "ev1",
    cameraId: "cam1",
    label: "person",
    comSnapshot: true,
    identificaPessoas: true,
    detectaGestos: false,
    ...over,
  });
  // o handler dispara `processar` sem segurar o emissor (o webhook não espera
  // reconhecimento): o teste precisa ceder a vez ao event loop antes de afirmar
  const assentar = () => new Promise((r) => setTimeout(r, 0));
  const emitir = async (payload: Record<string, unknown>) => {
    await events.emit("camera.detected", payload, { userId: "dono-1" });
    await assentar();
  };

  beforeAll(() => installCameraIdentityListener());

  beforeEach(() => {
    _resetCameraIdentityState();
    cfg.minIntervalSeconds = 5;
    cfg.labels = ["person", "pessoa"];
    vi.mocked(identifyCameraEvent).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(detectGestureForEvent).mockReset().mockResolvedValue([]);
  });

  it("evento com gente e snapshot identifica uma vez", async () => {
    await emitir(detectado());
    expect(identifyCameraEvent).toHaveBeenCalledWith("ev1");
  });

  it("rajada na mesma câmera identifica só uma vez", async () => {
    await emitir(detectado({ eventId: "ev1" }));
    await emitir(detectado({ eventId: "ev2" }));
    await emitir(detectado({ eventId: "ev3" }));

    expect(identifyCameraEvent).toHaveBeenCalledTimes(1);
    expect(identifyCameraEvent).toHaveBeenCalledWith("ev1");
  });

  it("o freio é por câmera: outra câmera não fica presa ao intervalo da primeira", async () => {
    await emitir(detectado({ cameraId: "cam1", eventId: "ev1" }));
    await emitir(detectado({ cameraId: "cam2", eventId: "ev2" }));

    expect(identifyCameraEvent).toHaveBeenCalledTimes(2);
  });

  it("evento sem snapshot não chama nada (não há o que olhar)", async () => {
    await emitir(detectado({ comSnapshot: false }));

    expect(identifyCameraEvent).not.toHaveBeenCalled();
    expect(detectGestureForEvent).not.toHaveBeenCalled();
  });

  it("câmera com rosto e gesto desligados não chama nada", async () => {
    await emitir(detectado({ identificaPessoas: false, detectaGestos: false }));

    expect(identifyCameraEvent).not.toHaveBeenCalled();
    expect(detectGestureForEvent).not.toHaveBeenCalled();
  });

  it("rótulo sem gente não acorda a visão", async () => {
    await emitir(detectado({ label: "car" }));

    expect(identifyCameraEvent).not.toHaveBeenCalled();
  });

  it("gesto vem depois do rosto, para a mão já ter dono", async () => {
    const ordem: string[] = [];
    vi.mocked(identifyCameraEvent).mockImplementation(async () => {
      ordem.push("rosto");
    });
    vi.mocked(detectGestureForEvent).mockImplementation(async () => {
      ordem.push("gesto");
      return [];
    });

    await emitir(detectado({ detectaGestos: true }));

    expect(ordem).toEqual(["rosto", "gesto"]);
  });

  it("falha no reconhecimento não trava a câmera para sempre", async () => {
    cfg.minIntervalSeconds = 0; // o que se quer provar é a liberação da vez, não o intervalo
    vi.mocked(identifyCameraEvent).mockRejectedValueOnce(new Error("percepção fora do ar"));

    await emitir(detectado({ eventId: "ev1" }));
    await emitir(detectado({ eventId: "ev2" }));

    expect(identifyCameraEvent).toHaveBeenCalledTimes(2);
  });

  it("uma identificação por vez por câmera, mesmo sem intervalo mínimo", async () => {
    // intervalo zerado tira o outro freio: o que sobra é a trava de "já tem uma
    // rodando", que é o que impede a fila no serviço local (CPU, CLAUDE.md §9)
    cfg.minIntervalSeconds = 0;
    let liberar = () => {};
    vi.mocked(identifyCameraEvent).mockImplementation(() => new Promise<void>((r) => (liberar = r)));

    await events.emit("camera.detected", detectado({ eventId: "ev1" }), { userId: "dono-1" });
    await events.emit("camera.detected", detectado({ eventId: "ev2" }), { userId: "dono-1" });
    await assentar();

    expect(identifyCameraEvent).toHaveBeenCalledTimes(1);
    liberar();
  });

  it("evento de outro tipo não mexe com a visão", async () => {
    await events.emit("identity.seen", { personId: "p1" }, { userId: "dono-1" });
    await assentar();

    expect(identifyCameraEvent).not.toHaveBeenCalled();
  });
});
