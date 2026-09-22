/**
 * A câmera deste aparelho.
 *
 * Para a Órbita, "câmera" sempre foi algo que EMPURRA imagem para ela: o
 * Frigate posta um evento com um instantâneo, e ela nunca abre dispositivo
 * nenhum. A webcam do notebook ficava de fora por consequência disso, não por
 * decisão: ela vive no navegador, e o servidor não tem como alcançá-la. O
 * resultado era a Órbita dizer, corretamente, que não havia câmera nenhuma —
 * e o "me ajuda com essa receita" também não funcionar.
 *
 * Aqui o navegador passa a ser o publicador: captura um quadro de vez em
 * quando e manda pelo mesmo caminho de ingestão. Tudo o que vem depois
 * (evento, identificação, presença, retenção) continua igual.
 *
 * Duas coisas que NÃO mudam, de propósito: isto só roda enquanto a aba está
 * aberta e a pessoa ligou, e identificar quem aparece continua sendo um
 * segundo opt-in, por câmera.
 */

export interface LimitesCamera {
  intervaloSegundos: number;
  larguraMaxima: number;
  qualidade: number;
  quadroMaxKB: number;
}

export const LIMITES_CAMERA_PADRAO: LimitesCamera = {
  intervaloSegundos: 20,
  larguraMaxima: 640,
  qualidade: 0.7,
  quadroMaxKB: 400,
};

let cache: Promise<LimitesCamera> | null = null;

export function limitesDaCamera(): Promise<LimitesCamera> {
  cache ??= fetch("/api/cameras/limits")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d: Partial<LimitesCamera>) => ({ ...LIMITES_CAMERA_PADRAO, ...d }))
    .catch(() => LIMITES_CAMERA_PADRAO);
  return cache;
}

/**
 * Quanto reduzir o quadro. Puro, para poder ser testado sem câmera.
 *
 * Nunca AUMENTA: uma webcam de 320px não vira 640 de mentira, isso só
 * inventaria pixels e pesaria mais no banco pelo mesmo detalhe.
 */
export function dimensoesDoQuadro(largura: number, altura: number, larguraMaxima: number): { largura: number; altura: number } {
  if (largura <= 0 || altura <= 0) return { largura: 0, altura: 0 };
  if (largura <= larguraMaxima) return { largura, altura };
  const fator = larguraMaxima / largura;
  return { largura: larguraMaxima, altura: Math.max(1, Math.round(altura * fator)) };
}

/** Tamanho aproximado, em KB, do conteúdo de uma data URL base64. Puro. */
export function tamanhoDaDataUrlKB(dataUrl: string): number {
  const virgula = dataUrl.indexOf(",");
  if (virgula < 0) return 0;
  const base64 = dataUrl.length - virgula - 1;
  // cada 4 caracteres de base64 são 3 bytes
  return Math.round((base64 * 3) / 4 / 1024);
}

export interface CameraDoAparelhoCallbacks {
  /** um quadro foi aceito pelo servidor */
  aoEnviar?: (kb: number) => void;
  /** algo impediu o envio; a captura continua tentando no próximo intervalo */
  aoFalhar?: (recado: string) => void;
}

/**
 * Liga a webcam e publica um quadro por intervalo, até `parar()`.
 *
 * A captura é por `setTimeout` encadeado e não por `setInterval`: com a aba em
 * segundo plano o navegador estrangula os temporizadores, e o `setInterval`
 * acumularia disparos atrasados para soltar todos de uma vez ao voltar — um
 * punhado de quadros idênticos no mesmo segundo, batendo no limite por minuto.
 */
export class CameraDoAparelho {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private vivo = false;

  constructor(
    private cameraId: string,
    private cb: CameraDoAparelhoCallbacks = {},
  ) {}

  get ativa(): boolean {
    return this.vivo;
  }

  /** O `<video>` interno, para a tela mostrar o que está sendo enviado. */
  get previa(): HTMLVideoElement | null {
    return this.video;
  }

  async iniciar(): Promise<void> {
    if (this.vivo) return;
    const limites = await limitesDaCamera();
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });

    const video = document.createElement("video");
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.video = video;
    this.canvas = document.createElement("canvas");

    this.vivo = true;
    // um primeiro quadro na hora: esperar o intervalo inteiro daria a impressão
    // de que ligar não fez nada
    void this.ciclo(limites);
  }

  private async ciclo(limites: LimitesCamera) {
    if (!this.vivo) return;
    try {
      await this.enviarQuadro(limites);
    } catch (e) {
      this.cb.aoFalhar?.(e instanceof Error ? e.message : "Não consegui enviar o quadro.");
    }
    if (!this.vivo) return;
    this.timer = setTimeout(() => void this.ciclo(limites), limites.intervaloSegundos * 1000);
  }

  private async enviarQuadro(limites: LimitesCamera) {
    const video = this.video;
    const canvas = this.canvas;
    if (!video || !canvas) return;

    const { largura, altura } = dimensoesDoQuadro(video.videoWidth, video.videoHeight, limites.larguraMaxima);
    if (!largura || !altura) return; // a câmera ainda não entregou quadro
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, largura, altura);
    const dataUrl = canvas.toDataURL("image/jpeg", limites.qualidade);

    const kb = tamanhoDaDataUrlKB(dataUrl);
    if (kb > limites.quadroMaxKB) {
      // o servidor aceitaria o evento mas jogaria a imagem fora; avisar é
      // melhor do que gravar um evento cego
      this.cb.aoFalhar?.(`O quadro ficou com ${kb} KB, acima do limite de ${limites.quadroMaxKB} KB. Diminua a largura em Ajustes.`);
      return;
    }

    const r = await fetch("/api/cameras/quadro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cameraId: this.cameraId, snapshot: dataUrl, label: "aparelho" }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error((d as { error?: string }).error ?? "O servidor recusou o quadro.");
    }
    this.cb.aoEnviar?.(kb);
  }

  parar(): void {
    this.vivo = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.stream = null;
    this.canvas = null;
  }
}
