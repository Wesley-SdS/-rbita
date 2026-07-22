/**
 * Web Speech API (reconhecimento de voz no navegador) — tipos + utilidades.
 *
 * Não está no lib.dom padrão do TS; tipamos só o que usamos. Roda no aparelho
 * (Chrome/Edge/Safari, incl. mobile), com resultado parcial na hora e sem upload.
 * Usado para o ditado ao vivo e para o wake word LOCAL — este último elimina a
 * dependência do serviço de voz remoto (que, no plano free do Render, hiberna e
 * fazia o "Ei Órbita" funcionar só às vezes).
 */

export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [i: number]: { readonly transcript: string };
}
export interface SpeechEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [i: number]: SpeechResultLike };
}
export interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
export type RecognitionCtor = new () => RecognitionLike;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// "Ei Órbita" / "Órbita". Casamos no texto SEM acento porque o `\b` do JS não
// trata letras acentuadas como caractere de palavra ("ó" quebraria a borda).
const WAKE_RE = /\b(?:ei\s+)?orbita\b/i;

/** Remove acentos (NFD + tira as marcas combinantes U+0300–U+036F). */
function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Detecta a frase de ativação no texto reconhecido. */
export function matchesWake(text: string): boolean {
  return WAKE_RE.test(semAcento(text));
}

/**
 * Wake word 100% no aparelho: um reconhecedor contínuo escuta a frase de
 * ativação e chama `onWake`. Ao detectar, PAUSA (libera o microfone para o
 * comando ser ditado) — quem trata `onWake` chama `resume()` quando terminar.
 * Religa sozinho quando o navegador encerra o reconhecimento (acontece a cada
 * ~1 min ou em silêncio prolongado).
 */
export class LocalWake {
  private rec: RecognitionLike | null = null;
  private listening = false; // deve estar ouvindo o gatilho agora?
  private on = false; // wake ligado (mesmo que pausado durante um comando)

  constructor(
    private Ctor: RecognitionCtor,
    private cb: { onWake: () => void; onError?: (msg: string) => void },
  ) {}

  start(): void {
    this.on = true;
    this.listening = true;
    this.spin();
  }

  /** Para de vez (usuário desligou o wake). */
  stop(): void {
    this.on = false;
    this.listening = false;
    try {
      this.rec?.abort();
    } catch {
      /* já parado */
    }
    this.rec = null;
  }

  /** Cede o microfone (ex.: para o comando ser ditado) sem desligar o wake. */
  pause(): void {
    this.listening = false;
    try {
      this.rec?.stop();
    } catch {
      /* já parado */
    }
  }

  /** Volta a escutar o gatilho após um comando. */
  resume(): void {
    if (this.on && !this.listening) {
      this.listening = true;
      this.spin();
    }
  }

  get active(): boolean {
    return this.on;
  }

  private spin(): void {
    if (!this.listening) return;
    const rec = new this.Ctor();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (last && matchesWake(last[0].transcript)) {
        this.pause(); // libera o mic para o comando
        this.cb.onWake();
      }
    };
    rec.onerror = (ev) => {
      if (ev.error !== "no-speech" && ev.error !== "aborted") this.cb.onError?.(ev.error);
    };
    rec.onend = () => {
      if (this.listening) this.spin(); // o navegador encerrou sozinho → religa
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* start durante transição: o onend religa */
    }
  }
}
