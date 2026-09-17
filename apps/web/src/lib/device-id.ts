/**
 * Id deste aparelho (navegador) salvo no localStorage após o cadastro em
 * Casa → Aparelhos (`home-panel.tsx`). Compartilhado pelo chat, pela voz em
 * tempo real e pelo push: é assim que "apaga a luz daqui" sabe onde é "aqui"
 * e por onde a Órbita avisa no cômodo em que a pessoa está (B5.3/B5.4).
 * Sem localStorage (SSR, modo privado bloqueado) o aparelho segue anônimo.
 */
export const DEVICE_ID_STORAGE_KEY = "orbita.deviceId";

export function getOwnDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}
