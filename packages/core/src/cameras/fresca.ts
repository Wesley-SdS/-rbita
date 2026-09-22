import { latestEventWithSnapshot } from "./query";
import { settings } from "../settings";
import type { CameraEvent } from "@orbita/db/camera-schema";

/**
 * A última imagem da câmera, desde que ela ainda valha como "agora".
 *
 * A janela é config do dono (`cameras.imagemFrescaSegundos`) e não constante
 * daqui: o que conta como recente muda com o uso. Uma câmera de portão pode
 * responder por uma imagem de dois minutos; "o que estou segurando" não.
 *
 * Falha na leitura da config cai no default e NÃO bloqueia: ficar sem imagem
 * por causa da configuração seria pior do que usar a janela padrão.
 */
export async function imagemFresca(cameraId: string): Promise<CameraEvent | null> {
  const janela = await settings.get("cameras.imagemFrescaSegundos").catch(() => 120);
  return latestEventWithSnapshot(cameraId, janela);
}
