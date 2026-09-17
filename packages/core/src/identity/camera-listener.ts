import { events } from "../events/index";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { identifyCameraEvent } from "./face";
import { detectGestureForEvent } from "./gesture";

/**
 * Identificação e gestos a partir de evento de câmera, por ASSINATURA DO EVENT
 * BUS (não por chamada direta da ingestão).
 *
 * Duas razões, as duas importantes:
 *   1. a cerca do NV.1: `cameras/ingest.ts` é caminho que fala com VLM de
 *      nuvem e não pode importar módulo de biometria. Aqui o acoplamento é um
 *      evento, e o módulo biométrico fica deste lado da cerca.
 *   2. rajada: o Frigate manda vários eventos por segundo quando alguém
 *      atravessa o campo de visão. Este é o lugar natural do freio (intervalo
 *      mínimo por câmera e uma identificação por vez por câmera), sem segurar
 *      a resposta do webhook.
 */

const ultimaPorCamera = new Map<string, number>();
const emAndamento = new Set<string>();

/** Vale a pena olhar este evento? Puro: rótulo que costuma ter gente e intervalo mínimo. */
export function shouldIdentify(
  label: string,
  cameraId: string,
  agoraMs: number,
  ultimaMs: number | undefined,
  minIntervalSeconds: number,
  labels: readonly string[],
): boolean {
  const normal = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (labels.length && !labels.some((l) => normal.includes(l.toLowerCase().trim()))) return false;
  if (ultimaMs !== undefined && agoraMs - ultimaMs < minIntervalSeconds * 1000) return false;
  return cameraId.length > 0;
}

async function processar(payload: Record<string, unknown>): Promise<void> {
  const eventId = typeof payload.eventId === "string" ? payload.eventId : null;
  const cameraId = typeof payload.cameraId === "string" ? payload.cameraId : null;
  const label = typeof payload.label === "string" ? payload.label : "";
  const identifica = payload.identificaPessoas === true;
  const gestos = payload.detectaGestos === true;
  if (!eventId || !cameraId || (!identifica && !gestos) || payload.comSnapshot !== true) return;

  const cfg = await settings.getMany(["identity.identifyMinIntervalSeconds", "identity.identifyLabels"]);
  if (!shouldIdentify(label, cameraId, Date.now(), ultimaPorCamera.get(cameraId), cfg["identity.identifyMinIntervalSeconds"], cfg["identity.identifyLabels"])) return;
  // uma por câmera de cada vez: o serviço local é CPU, e fila aqui é melhor que
  // timeout lá (CLAUDE.md §9: modelo local satura a máquina inteira)
  if (emAndamento.has(cameraId)) return;

  emAndamento.add(cameraId);
  ultimaPorCamera.set(cameraId, Date.now());
  try {
    if (identifica) await identifyCameraEvent(eventId);
    // gesto depois do rosto: assim o evento já sabe de quem é a mão
    if (gestos) await detectGestureForEvent(eventId);
  } catch (e) {
    log.warn("identity.camera_falhou", { cameraId, error: e instanceof Error ? e.message : String(e) });
  } finally {
    emAndamento.delete(cameraId);
  }
}

let instalado = false;

/** Liga o listener no processo persistente (apps/api). Idempotente. */
export function installCameraIdentityListener(): void {
  if (instalado) return;
  instalado = true;
  events.on("camera.detected", (ev) => {
    void processar(ev.payload).catch((e) => log.warn("identity.camera_listener", { error: e instanceof Error ? e.message : String(e) }));
  });
}

/** Só para teste: esquece o estado de freio entre casos. */
export function _resetCameraIdentityState(): void {
  ultimaPorCamera.clear();
  emAndamento.clear();
}
