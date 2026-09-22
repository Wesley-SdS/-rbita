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
/**
 * O reconhecedor do navegador quase nunca devolve "Ei Órbita" na grafia certa.
 * O que chega são variações fonéticas, e cada uma que falta é um chamado
 * perdido em silêncio: sem erro, sem log, sem nada explicando. Medido nesta
 * casa, "Ei Órbita" falado chegou escrito como **"em órbita"**.
 *
 * A raiz é sempre o mesmo som (o/ó + r + b/p + vogal + t/d + a), e o prefixo
 * varia entre ei, e, eh, hey, em, ai, oi.
 *
 * O NOME SOZINHO só acorda no COMEÇO da fala. É o que separa "Órbita, tá me
 * ouvindo?" (chamado) de "a órbita da lua é elíptica" (assunto). No meio da
 * frase, exige o prefixo de chamamento — acordar sozinha durante uma conversa
 * sobre astronomia é pior do que não acordar.
 */
const CHAMA = "(?:ei|e|eh|hey|ai|em|oi)";
const NOME = "[oóh]+r[bp]i?[dt]a[s]?\\b";
const WAKE_RE = new RegExp(`(?:^\\s*(?:${CHAMA}[\\s,]+)?|[\\s,.!?]${CHAMA}[\\s,]+)${NOME}`, "i");

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
    private cb: {
      onWake: () => void;
      onError?: (msg: string) => void;
      /**
       * O que o reconhecedor ENTENDEU, tenha acordado ou não.
       *
       * Sem isto, um wake que não dispara é invisível: não há erro, não há
       * log, e a única informação é "não funcionou". Com isto dá para ver que
       * a fala virou "em órbita" e corrigir o padrão em vez de adivinhar.
       */
      onOuvido?: (texto: string) => void;
    },
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
      if (last) this.cb.onOuvido?.(last[0].transcript);
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

/**
 * Ditado contínuo para PRÉVIA ao vivo (reunião).
 *
 * Por que Web Speech e não o /api/stt: a prévia roda no aparelho, é instantânea,
 * não sobe áudio e não custa nada. O fluxo antigo mandava uma janela de 8s para
 * a AssemblyAI a cada 8s — numa reunião de 1h isso são ~450 jobs pagos só para
 * desenhar texto na tela.
 *
 * ⚠️ Isto é PRÉVIA, não a transcrição final. A final vem da gravação contínua
 * (`ContinuousRecorder`), transcrita de uma vez com separação de vozes. Duas
 * consequências que a UI precisa deixar claras: a prévia só ouve o MICROFONE
 * (não o áudio do sistema) e não separa quem falou.
 */
export class ContinuousDictation {
  private rec: RecognitionLike | null = null;
  private on = false;
  private finalText = "";

  constructor(
    private Ctor: RecognitionCtor,
    private cb: { onText: (text: string) => void },
  ) {}

  start(): void {
    this.on = true;
    this.finalText = "";
    this.spin();
  }

  stop(): void {
    this.on = false;
    try {
      this.rec?.abort();
    } catch {
      /* já parado */
    }
    this.rec = null;
  }

  get active(): boolean {
    return this.on;
  }

  private spin(): void {
    if (!this.on) return;
    const rec = new this.Ctor();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.cb.onText((this.finalText + interim).trim());
    };
    rec.onerror = () => {
      /* transitório (no-speech/aborted): o onend religa */
    };
    rec.onend = () => {
      // o navegador encerra sozinho a cada ~1 min; numa reunião longa isso
      // aconteceria dezenas de vezes — religar é o que mantém a prévia viva.
      if (this.on) this.spin();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* start durante transição: o onend religa */
    }
  }
}
