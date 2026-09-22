/**
 * Captura do microfone para a conversa por voz em tempo real (Gemini Live).
 *
 * Roda na thread de áudio, então não decide nada: só copia o quadro e devolve.
 * Qualquer trabalho aqui dentro (converter, acumular, decidir) vira estalo
 * audível, porque uma pausa nesta thread é uma falha no som.
 *
 * É um ARQUIVO e não um blob de propósito. O blob era bloqueado pela CSP:
 * `addModule` de um worklet passa por `script-src`, que aqui é `'self'`, e
 * `blob:` não está nem deve estar nessa lista. Servido daqui, carrega como
 * qualquer script do app e a CSP continua fechada.
 */
class CapturaPcm extends AudioWorkletProcessor {
  process(inputs) {
    const canal = inputs[0] && inputs[0][0];
    // cópia: o buffer do quadro é reaproveitado pelo motor no próximo ciclo
    if (canal) this.port.postMessage(new Float32Array(canal));
    return true;
  }
}

registerProcessor("captura-pcm", CapturaPcm);
