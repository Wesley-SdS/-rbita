/**
 * Engine de voz do cliente (browser):
 * - LocalTTS: toca o WAV do TTS local (Piper) via /api/tts, com stop() p/ barge-in.
 * - WakeListener: captura o microfone a 16 kHz, envia frames PCM ao serviço de
 *   voz (WebSocket openWakeWord) e dispara onWake ao detectar "Ei Órbita".
 *   Também emite o nível de energia (RMS) para permitir barge-in.
 */

export class LocalTTS {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;

  /** Sintetiza e toca. Resolve quando termina (ou é interrompido). */
  async speak(text: string, opts?: { onStart?: () => void; onEnd?: () => void }): Promise<void> {
    this.stop();
    const clean = text.replace(/[#*_`>[\]]/g, "").slice(0, 2000);
    if (!clean.trim()) return;
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
    });
    if (!res.ok) throw new Error("tts_indisponivel");
    const blob = await res.blob();
    this.url = URL.createObjectURL(blob);
    const audio = new Audio(this.url);
    this.audio = audio;
    return new Promise<void>((resolve) => {
      audio.onplay = () => opts?.onStart?.();
      const done = () => {
        opts?.onEnd?.();
        this.cleanup();
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      void audio.play().catch(done);
    });
  }

  /** Interrompe a fala imediatamente (barge-in). */
  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    this.cleanup();
  }

  get speaking(): boolean {
    return !!this.audio && !this.audio.paused;
  }

  private cleanup() {
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }
}

const FRAME = 1280; // 80 ms @ 16 kHz — tamanho esperado pelo openWakeWord

export interface WakeCallbacks {
  onWake?: () => void;
  onError?: (msg: string) => void;
  /** energia RMS por frame (0..1), para barge-in enquanto a Órbita fala. */
  onEnergy?: (rms: number) => void;
}

export class WakeListener {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private ws: WebSocket | null = null;
  private buffer: number[] = [];
  private running = false;

  constructor(private wsUrl: string, private cb: WakeCallbacks = {}) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    // Chrome respeita sampleRate no construtor; senão reamostra na conversão.
    this.ctx = new AudioContext({ sampleRate: 16000 });
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.ws = new WebSocket(this.wsUrl);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string);
        if (d.error) this.cb.onError?.(d.error);
        else if (d.detected) this.cb.onWake?.();
      } catch {
        /* ignore */
      }
    };
    this.ws.onerror = () => this.cb.onError?.("ws_erro");

    const src = this.ctx.createMediaStreamSource(this.stream);
    const node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node = node;
    node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      // energia p/ barge-in
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      this.cb.onEnergy?.(Math.sqrt(sum / input.length));
      // acumula e envia frames de 1280 amostras int16
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
      while (this.buffer.length >= FRAME) {
        const frame = this.buffer.splice(0, FRAME);
        const pcm = Int16Array.from(frame);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm.buffer);
      }
    };
    src.connect(node);
    node.connect(this.ctx.destination);
  }

  stop() {
    this.running = false;
    this.node?.disconnect();
    this.node = null;
    this.ws?.close();
    this.ws = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.buffer = [];
  }

  get active(): boolean {
    return this.running;
  }
}
