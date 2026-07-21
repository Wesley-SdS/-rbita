/**
 * Engine de voz do cliente (browser):
 * - LocalTTS: sintetiza a fala por frases via /api/tts e toca em sequência,
 *   com stop() p/ barge-in.
 * - WakeListener: captura o microfone a 16 kHz, envia frames PCM ao serviço de
 *   voz (WebSocket openWakeWord) e dispara onWake ao detectar "Ei Órbita".
 *   Também emite o nível de energia (RMS) para permitir barge-in.
 */

// Medido no Gemini TTS: sintetizar custa ~1 s por segundo de áudio gerado.
// Daí o desenho: o 1º trecho é curto (a fala começa logo) e os seguintes são
// maiores — como síntese ≈ duração, o próximo fica pronto enquanto o atual toca.
const PRIMEIRO_CH = 45; // alvo do 1º trecho: ~2 s até a Órbita abrir a boca
const MIN_CH = 80; // demais trechos: pedidos minúsculos não compensam o RTT
const MAX_CH = 200; // teto por pedido — acima disso a síntese demora demais

/**
 * Quebra o texto em blocos faláveis, priorizando fim de frase e depois vírgula.
 * Sem isso, uma resposta de 200 caracteres só começaria a ser falada 14 s depois.
 */
export function splitFala(text: string): string[] {
  const frases = text.match(/[^.!?…\n]+[.!?…\n]*/g) ?? [text];
  const out: string[] = [];
  let buf = "";

  const empurra = () => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = "";
  };
  const alvo = () => (out.length === 0 ? PRIMEIRO_CH : MIN_CH);

  for (const frase of frases) {
    if (buf.length + frase.length <= MAX_CH) {
      buf += frase;
      if (buf.length >= alvo()) empurra();
      continue;
    }
    empurra();
    if (frase.length <= MAX_CH) { buf = frase; continue; }
    // frase gigante sem pontuação final: parte nas vírgulas
    let resto = frase;
    while (resto.length > MAX_CH) {
      const corte = resto.lastIndexOf(",", MAX_CH);
      const at = corte > MIN_CH ? corte + 1 : MAX_CH;
      out.push(resto.slice(0, at).trim());
      resto = resto.slice(at);
    }
    buf = resto;
  }
  empurra();

  // O 1º trecho manda na latência: se uma frase longa o inflou (ex.: "Bom dia!"
  // grudado numa frase de 90 caracteres), corta na vírgula para a fala começar antes.
  if (out[0] && out[0].length > PRIMEIRO_CH * 1.5) {
    const virgula = out[0].lastIndexOf(",", PRIMEIRO_CH + 20);
    if (virgula > 15) {
      const [cabeca, cauda] = [out[0].slice(0, virgula + 1).trim(), out[0].slice(virgula + 1).trim()];
      if (cauda) out.splice(0, 1, cabeca, cauda);
    }
  }

  return out.filter(Boolean);
}

export class LocalTTS {
  private audio: HTMLAudioElement | null = null;
  // guardados para que stop() (barge-in) também finalize a fala em curso:
  private endCurrent: (() => void) | null = null;
  private abort: AbortController | null = null;

  private async fetchTrecho(texto: string, signal: AbortSignal): Promise<Blob> {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: texto }),
      signal,
    });
    if (!res.ok) throw new Error("tts_indisponivel");
    return res.blob();
  }

  /** Toca um blob até o fim (ou até stop()). Resolve nos dois casos. */
  private tocar(blob: Blob, urls: string[], onStart?: () => void): Promise<void> {
    const url = URL.createObjectURL(blob);
    urls.push(url); // por invocação: uma fala nova não revoga as URLs da outra
    const audio = new Audio(url);
    this.audio = audio;
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return; // idempotente: fim natural OU stop() chamam só uma vez
        settled = true;
        this.endCurrent = null;
        resolve();
      };
      this.endCurrent = done; // stop() usa isto para destravar o await
      audio.onplay = () => onStart?.();
      audio.onended = done;
      audio.onerror = done;
      void audio.play().catch(done);
    });
  }

  /**
   * Sintetiza e toca por trechos. Resolve quando termina OU é interrompido.
   * Enquanto um trecho toca, o próximo já está sendo sintetizado.
   */
  async speak(text: string, opts?: { onStart?: () => void; onEnd?: () => void }): Promise<void> {
    this.stop();
    const clean = text.replace(/[#*_`>[\]]/g, "").slice(0, 2000);
    if (!clean.trim()) return;

    const trechos = splitFala(clean);
    // barge-in durante a síntese também aborta os fetches (senão o áudio ainda
    // chegaria e poderia tocar depois de o usuário já ter interrompido).
    const ctrl = new AbortController();
    this.abort = ctrl;

    const abortado = () => this.abort !== ctrl || ctrl.signal.aborted;
    const urls: string[] = [];
    let comecou = false;

    // prefetch de profundidade 1: o próximo trecho é pedido antes de tocar o atual.
    // guardamos o erro em vez de deixar a promise rejeitar sozinha (unhandled).
    const pedir = (i: number): Promise<Blob | Error> | null =>
      i < trechos.length
        ? this.fetchTrecho(trechos[i], ctrl.signal).catch((e: unknown) => (e instanceof Error ? e : new Error("tts")))
        : null;

    try {
      let proximo = pedir(0);
      for (let i = 0; i < trechos.length; i++) {
        const r = await proximo!;
        if (abortado()) return;
        if (r instanceof Error) {
          if (r.name === "AbortError") return; // interrompido: ok
          if (comecou) return; // já falou algo; não derruba a voz por causa da cauda
          throw r;
        }

        proximo = pedir(i + 1);
        await this.tocar(r, urls, comecou ? undefined : opts?.onStart);
        comecou = true;
        if (abortado()) return;
      }
    } finally {
      if (this.abort === ctrl) {
        // ninguém preemptou esta fala: ela é dona de encerrar o estado
        this.abort = null;
        this.audio = null;
        opts?.onEnd?.();
      }
      for (const u of urls) URL.revokeObjectURL(u);
    }
  }

  /** Interrompe a fala imediatamente (barge-in) — resolve a Promise e roda onEnd. */
  stop() {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    const end = this.endCurrent;
    this.endCurrent = null;
    end?.(); // destrava o await do trecho em curso (o finally do speak revoga as URLs)
  }

  get speaking(): boolean {
    return !!this.audio && !this.audio.paused;
  }
}

/**
 * Grava o microfone até detectar silêncio (VAD por energia) — para o fluxo
 * mãos-livres "Ei Órbita, faça tal coisa". Espera o usuário começar a falar,
 * e encerra após `silenceMs` de silêncio, ou no `maxMs`.
 */
export async function recordUntilSilence(opts?: {
  silenceMs?: number;
  maxMs?: number;
  onSpeech?: () => void;
}): Promise<Blob | null> {
  const silenceMs = opts?.silenceMs ?? 1200;
  const maxMs = opts?.maxMs ?? 12000;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start();

  const started = Date.now();
  let speechStarted = false;
  let lastVoice = Date.now();

  return new Promise<Blob | null>((resolve) => {
    const cleanup = () => {
      clearInterval(timer);
      try { rec.stop(); } catch { /* noop */ }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    };
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: "audio/webm" }) : null);

    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      if (rms > 0.02) {
        if (!speechStarted) { speechStarted = true; opts?.onSpeech?.(); }
        lastVoice = now;
      }
      const elapsed = now - started;
      const silentFor = now - lastVoice;
      if ((speechStarted && silentFor > silenceMs) || elapsed > maxMs) cleanup();
    }, 100);
  });
}

const FRAME = 1280; // 80 ms @ 16 kHz — frames PCM para o wake word

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
