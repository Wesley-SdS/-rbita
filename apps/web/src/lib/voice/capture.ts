/**
 * Captura de áudio para reunião.
 *
 * Duas correções estruturais em relação ao fluxo antigo (janelas de 8s):
 *
 * 1. GRAVAÇÃO CONTÍNUA. Antes, cada janela era um `MediaRecorder` novo, e o
 *    intervalo entre `stop()` e o `start()` seguinte caía no chão — a reunião
 *    perdia pedaços. Aqui um único recorder roda do início ao fim; o `timeslice`
 *    só fatia o BUFFER (os pedaços remontam num blob só), não a captura.
 *
 * 2. ÁUDIO DO SISTEMA. Só o microfone não capta Teams/Meet/Slack — a voz dos
 *    outros sai pela caixa de som. `getDisplayMedia` com áudio pega o som da
 *    aba/tela, e misturamos com o microfone num stream só.
 *
 * Ambos são pré-requisito da diarização: separar vozes exige o áudio INTEIRO
 * numa requisição só (os rótulos A/B/C são atribuídos por requisição).
 */

export interface MeetingCapture {
  stream: MediaStream;
  /** Conseguiu capturar o áudio do sistema além do microfone? */
  hasSystemAudio: boolean;
  /** O microfone foi aberto com o tratamento de chamada ligado? (a UI explica) */
  micProcessado: boolean;
  stop(): void;
}

/** Como o navegador deve tratar o microfone. Espelha `meetings.processarMicrofone`. */
export type ModoDeMicrofone = "auto" | "sempre" | "nunca";

/**
 * O navegador trata o microfone para CHAMADA, não para reunião gravada:
 * cancelamento de eco, redução de ruído e ganho automático são afinados para UMA
 * voz perto do aparelho.
 *
 * Numa reunião com duas pessoas na MESMA SALA isso trabalha contra a gente, e
 * de dois jeitos: o ganho automático nivela as vozes (e a diarização separa
 * justamente pela diferença entre elas) e a redução de ruído come a fala de
 * quem está mais longe do aparelho. Medido em 26/09/2026: 22s de conversa entre
 * duas pessoas na sala voltaram com UM locutor só e falas truncadas.
 *
 * Com áudio da tela, o tratamento volta a ser necessário: a voz dos outros sai
 * pela caixa de som e entraria duas vezes (pelo mic e pela captura da tela).
 */
export function restricoesDoMicrofone(modo: ModoDeMicrofone, comAudioDeTela: boolean): MediaTrackConstraints {
  const tratar = modo === "sempre" ? true : modo === "nunca" ? false : comAudioDeTela;
  return { echoCancellation: tratar, noiseSuppression: tratar, autoGainControl: tratar };
}

/** Mistura N streams de áudio num só (Web Audio). */
function mix(ctx: AudioContext, streams: MediaStream[]): MediaStream {
  const dest = ctx.createMediaStreamDestination();
  for (const s of streams) {
    if (s.getAudioTracks().length) ctx.createMediaStreamSource(s).connect(dest);
  }
  return dest.stream;
}

/**
 * Abre a captura da reunião. Com `systemAudio`, pede também o som da tela/aba.
 *
 * O usuário PRECISA marcar "compartilhar áudio" no diálogo do Chrome; se não
 * marcar, seguimos só com o microfone e devolvemos `hasSystemAudio: false` para
 * a UI avisar (em vez de gravar meia reunião em silêncio sem ninguém notar).
 */
export async function startMeetingCapture(opts: { systemAudio: boolean; microfone?: ModoDeMicrofone }): Promise<MeetingCapture> {
  // O tratamento é decidido pela INTENÇÃO de capturar a tela, que é o que se
  // sabe antes de abrir o microfone. Pedir a tela primeiro daria a resposta
  // exata, mas jogaria o diálogo de compartilhamento na frente do de microfone.
  const audio = restricoesDoMicrofone(opts.microfone ?? "auto", opts.systemAudio);
  const micProcessado = audio.echoCancellation === true;
  const mic = await navigator.mediaDevices.getUserMedia({ audio });

  if (!opts.systemAudio) {
    return {
      stream: mic,
      hasSystemAudio: false,
      micProcessado,
      stop: () => mic.getTracks().forEach((t) => t.stop()),
    };
  }

  let display: MediaStream | null = null;
  try {
    // `video: true` é obrigatório no Chrome para a caixa "compartilhar áudio"
    // aparecer no diálogo. Descartamos o vídeo logo abaixo — só queremos o som.
    display = await (
      navigator.mediaDevices as MediaDevices & { getDisplayMedia: (c: unknown) => Promise<MediaStream> }
    ).getDisplayMedia({ video: true, audio: true });
  } catch {
    display = null; // usuário cancelou o diálogo
  }

  const sysTracks = display?.getAudioTracks() ?? [];
  display?.getVideoTracks().forEach((t) => t.stop()); // vídeo não é usado

  if (!sysTracks.length) {
    display?.getTracks().forEach((t) => t.stop());
    return {
      stream: mic,
      hasSystemAudio: false,
      micProcessado,
      stop: () => mic.getTracks().forEach((t) => t.stop()),
    };
  }

  const sys = new MediaStream(sysTracks);
  const ctx = new AudioContext();
  const mixed = mix(ctx, [mic, sys]);

  return {
    stream: mixed,
    hasSystemAudio: true,
    micProcessado,
    stop: () => {
      mic.getTracks().forEach((t) => t.stop());
      sys.getTracks().forEach((t) => t.stop());
      display?.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

/** Escolhe o melhor container/codec que o navegador aceita gravar. */
function pickMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Gravador contínuo: um `MediaRecorder` do início ao fim, sem buraco.
 * O `timeslice` existe só para o browser entregar os pedaços aos poucos (evita
 * segurar uma reunião inteira num buffer único); eles são remontados no `stop()`.
 */
export class ContinuousRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mime = "audio/webm";

  /**
   * `bitrate` em bits por segundo; 0 (ou ausente) deixa o navegador escolher.
   * Escolher vale a pena: o padrão do Chrome para áudio é afinado para voz de
   * chamada, e a diarização depende de ouvir a diferença entre duas vozes.
   */
  start(stream: MediaStream, bitrate = 0): void {
    const mimeType = pickMimeType();
    this.mime = mimeType ?? "audio/webm";
    this.chunks = [];
    const opcoes: MediaRecorderOptions = {
      ...(mimeType ? { mimeType } : {}),
      ...(bitrate > 0 ? { audioBitsPerSecond: bitrate } : {}),
    };
    const rec = new MediaRecorder(stream, opcoes);
    rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec = rec;
    this.startedAt = Date.now();
    rec.start(5000);
  }

  /** Encerra e devolve a reunião inteira num blob só. */
  async stop(): Promise<Blob | null> {
    const rec = this.rec;
    this.rec = null;
    if (!rec || rec.state === "inactive") {
      return this.chunks.length ? new Blob(this.chunks, { type: this.mime }) : null;
    }
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    return this.chunks.length ? new Blob(this.chunks, { type: this.mime }) : null;
  }

  get elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  get active(): boolean {
    return this.rec !== null && this.rec.state === "recording";
  }
}
