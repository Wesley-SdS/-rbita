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
  stop(): void;
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
export async function startMeetingCapture(opts: { systemAudio: boolean }): Promise<MeetingCapture> {
  const mic = await navigator.mediaDevices.getUserMedia({
    // Com o áudio do sistema saindo pela caixa de som, o cancelamento de eco
    // evita que a fala dos outros entre DUAS vezes (pelo mic e pela captura).
    audio: { echoCancellation: true, noiseSuppression: true },
  });

  if (!opts.systemAudio) {
    return {
      stream: mic,
      hasSystemAudio: false,
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
      stop: () => mic.getTracks().forEach((t) => t.stop()),
    };
  }

  const sys = new MediaStream(sysTracks);
  const ctx = new AudioContext();
  const mixed = mix(ctx, [mic, sys]);

  return {
    stream: mixed,
    hasSystemAudio: true,
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

  start(stream: MediaStream): void {
    const mimeType = pickMimeType();
    this.mime = mimeType ?? "audio/webm";
    this.chunks = [];
    const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
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
