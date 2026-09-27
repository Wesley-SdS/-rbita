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
  /** O que o navegador REALMENTE aplicou no microfone (vai para o log). */
  audio: AudioEfetivo;
  stop(): void;
}

/**
 * O que o navegador de fato aplicou na trilha do microfone.
 *
 * Existe porque "o microfone está ruim" era palpite, e palpite não se conserta.
 * Pedir uma restrição não garante que ela valeu: o navegador pode ignorar, o
 * aparelho pode não suportar, e o padrão de uma caixa marcada na tela pode ter
 * mandado o contrário do que se queria. Isto é a MEDIÇÃO, e ela viaja junto da
 * gravação para o log dizer o que aconteceu.
 */
export interface AudioEfetivo {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  channelCount?: number;
  /** O áudio da tela entrou mesmo? É o que EXPLICA o tratamento estar ligado. */
  comAudioDeTela?: boolean;
}

/** Lê da trilha o que valeu de verdade. */
export function audioEfetivo(track: MediaStreamTrack | undefined): AudioEfetivo {
  if (!track) return {};
  const s = track.getSettings() as MediaTrackSettings & { autoGainControl?: boolean };
  return {
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
    sampleRate: s.sampleRate,
    channelCount: s.channelCount,
  };
}

/** Como o navegador deve tratar o microfone. Espelha `meetings.processarMicrofone`. */
export type ModoDeMicrofone = "auto" | "sempre" | "nunca";

/**
 * Quantas vozes esperar, a partir do que o dono digitou na tela.
 *
 * É só uma DICA para a separação de vozes, mas faz diferença grande: sem ela, um
 * áudio curto de duas pessoas na mesma sala volta rotulado como um locutor só
 * (medido em 26/09/2026). Fora da faixa que a separação aceita (2 a 10) vira 0,
 * que significa "não sei" — melhor deixar o provedor decidir do que mandar um
 * número inventado.
 */
export function vozesEsperadas(valor: string): number {
  const n = Number(valor.trim());
  return Number.isInteger(n) && n >= 2 && n <= 10 ? n : 0;
}

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
  return {
    echoCancellation: tratar,
    noiseSuppression: tratar,
    autoGainControl: tratar,
    // `voiceIsolation` (Chrome recente) isola a voz PRINCIPAL e joga o resto
    // fora. Numa reunião ele apaga justamente a segunda pessoa, então fica
    // desligado até com o tratamento ligado. Navegador que não conhece a
    // restrição a ignora, e o cast existe porque ela ainda não está no lib.dom.
    voiceIsolation: false,
  } as MediaTrackConstraints;
}

/** Abre o microfone com um conjunto de restrições. Pedir 48 kHz é de graça: o
 *  que sobra a separação de vozes descarta, o que falta não se recupera. */
function abrirMicrofone(restricoes: MediaTrackConstraints): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { ...restricoes, sampleRate: 48000 } });
}

/** O tratamento aplicado bate com o pedido? Só estes três importam para a separação. */
function tratamentoBate(atual: AudioEfetivo, alvo: MediaTrackConstraints): boolean {
  return (
    atual.echoCancellation === alvo.echoCancellation &&
    atual.noiseSuppression === alvo.noiseSuppression &&
    atual.autoGainControl === alvo.autoGainControl
  );
}

/**
 * Corrige o tratamento do microfone DEPOIS de saber se o áudio da tela entrou
 * mesmo. Devolve a trilha que vale e o que ela de fato aplicou.
 *
 * A primeira decisão é tomada pela INTENÇÃO, que é o que se sabe antes de abrir
 * o microfone — e a intenção erra no caso mais comum: a caixa "capturar também
 * o áudio da tela" vem MARCADA por padrão, e quando o diálogo é cancelado a
 * reunião é de microfone puro, com o tratamento ligado à toa.
 *
 * ⚠️ `applyConstraints` NÃO serve para isto. Foi a primeira tentativa e ela
 * falhou em silêncio: o Chrome aceita a chamada, não lança nada, e
 * `getSettings()` continua devolvendo os valores antigos — a cadeia de
 * processamento de áudio é montada quando a trilha nasce. Medido em 26/09/2026,
 * e só apareceu porque a medição vai para o log: `comAudioDeTela: false` com
 * `echoCancellation: true` na mesma linha. A única forma que funciona é ABRIR A
 * TRILHA DE NOVO — não custa permissão (já foi concedida) e a gravação começa
 * depois, então não se perde áudio.
 */
async function ajustarMicrofone(
  mic: MediaStream,
  modo: ModoDeMicrofone,
  comAudioDeTela: boolean,
): Promise<{ mic: MediaStream; audio: AudioEfetivo }> {
  const alvo = restricoesDoMicrofone(modo, comAudioDeTela);
  const atual = audioEfetivo(mic.getAudioTracks()[0]);
  if (tratamentoBate(atual, alvo)) return { mic, audio: atual };

  try {
    const novo = await abrirMicrofone(alvo);
    mic.getTracks().forEach((t) => t.stop());
    return { mic: novo, audio: audioEfetivo(novo.getAudioTracks()[0]) };
  } catch {
    // aparelho ocupado ou permissão revogada no meio: segue com o que já tem, e
    // a medição conta a verdade em vez de prometer o que não houve
    return { mic, audio: atual };
  }
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
  const modo = opts.microfone ?? "auto";
  // Abre pela INTENÇÃO e corrige depois, quando se souber se o áudio da tela
  // entrou de verdade (ver `ajustarMicrofone`).
  const inicial = await abrirMicrofone(restricoesDoMicrofone(modo, opts.systemAudio));

  if (!opts.systemAudio) {
    const { mic, audio } = await ajustarMicrofone(inicial, modo, false);
    return {
      stream: mic,
      hasSystemAudio: false,
      audio,
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
    // Pediu a tela e não veio som (diálogo cancelado, ou sem marcar
    // "compartilhar áudio"): é uma reunião de microfone, e o tratamento tem de
    // SAIR. É o caso mais comum, porque a caixa vem marcada por padrão.
    const { mic, audio } = await ajustarMicrofone(inicial, modo, false);
    return {
      stream: mic,
      hasSystemAudio: false,
      audio,
      stop: () => mic.getTracks().forEach((t) => t.stop()),
    };
  }

  const { mic, audio } = await ajustarMicrofone(inicial, modo, true);
  const sys = new MediaStream(sysTracks);
  const ctx = new AudioContext();
  const mixed = mix(ctx, [mic, sys]);

  return {
    stream: mixed,
    hasSystemAudio: true,
    audio,
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
