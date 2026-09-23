import { getOwnDeviceId } from "@/lib/device-id";
import { capturarUmQuadro, ehCameraDesteAparelho, garantirCameraDoAparelho } from "@/lib/camera/aparelho";
import type { RealtimeCallbacks, SessaoRealtime } from "./realtime";

/**
 * Cliente do Gemini Live (voz em tempo real por WebSocket).
 *
 * É o irmão barato do `RealtimeSession` da OpenAI: mesma interface, mesmo
 * gate, transporte diferente. Enquanto a OpenAI entrega WebRTC pronto (a
 * captura, a reprodução e o barge-in vêm de graça na pilha do navegador),
 * aqui o áudio é NOSSO problema — o protocolo troca PCM cru dos dois lados:
 *
 *   entrada  16 kHz, 16 bits, mono, em base64, a cada ~100 ms
 *   saída    24 kHz, 16 bits, mono, em pedaços que precisam ser enfileirados
 *
 * Os dois formatos foram conferidos contra a API, não deduzidos da doc.
 */

/** Pedaço enviado ao modelo. 100 ms é o que a API pede: menor gasta mensagem à toa, maior atrasa a resposta. */
const MS_POR_ENVIO = 100;
const TAXA_ENTRADA = 16000;
const TAXA_SAIDA = 24000;

/** Reamostragem linear. Existe porque nem todo navegador honra o `sampleRate` pedido no AudioContext. */
function reamostrar(entrada: Float32Array, de: number, para: number): Float32Array {
  if (de === para) return entrada;
  const razao = de / para;
  const saida = new Float32Array(Math.floor(entrada.length / razao));
  for (let i = 0; i < saida.length; i++) {
    const pos = i * razao;
    const j = Math.floor(pos);
    const frac = pos - j;
    saida[i] = (entrada[j] ?? 0) * (1 - frac) + (entrada[j + 1] ?? entrada[j] ?? 0) * frac;
  }
  return saida;
}

function paraBase64(bytes: Uint8Array): string {
  let s = "";
  // em blocos: `String.fromCharCode(...)` com um array grande estoura a pilha
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function deBase64(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

/**
 * O worklet de captura, servido de `public/`.
 *
 * Foi um blob na primeira versão e não funcionou: `addModule` carrega o
 * worklet sob `script-src`, que nesta casa é `'self'`, então o navegador
 * recusava com "Failed to load worklet module script: blob:…". Afrouxar a CSP
 * para `blob:` liberaria qualquer script gerado em tempo de execução — caro
 * demais por um arquivo de dez linhas que pode simplesmente ter URL.
 */
const CAMINHO_WORKLET = "/audio/captura-pcm.js";

/** De quanto em quanto tempo a conta parcial sobe. Dois minutos perde pouco e não vira enxurrada de requisição. */
const INTERVALO_DO_RELATO = 120_000;

interface RespostaSessao {
  provider?: string;
  url?: string;
  setup?: Record<string, unknown>;
  model?: string;
  error?: string;
}

export class GeminiLiveSession implements SessaoRealtime {
  private ws: WebSocket | null = null;
  private micCtx: AudioContext | null = null;
  private somCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private no: AudioWorkletNode | null = null;
  private acumulado: Float32Array[] = [];
  private amostras = 0;
  /** quando o próximo pedaço de fala deve começar, para a voz sair contínua */
  private proximoInicio = 0;
  private tocando = new Set<AudioBufferSourceNode>();
  private transcricaoDela = "";
  private transcricaoMinha = "";
  private fechando = false;
  /**
   * O que esta sessão já consumiu, por tipo de unidade.
   *
   * O áudio vai do navegador DIRETO ao Google: o servidor não vê a conversa
   * passar e portanto não tem como contar. Quem conta é o provedor, no
   * `usageMetadata` de cada resposta, e quem entrega essa conta para a casa é
   * este cliente (POST /api/uso/sessao).
   *
   * Somamos CADA mensagem em vez de guardar a última. Medido contra a API em
   * 22/09/2026, em três turnos seguidos: `responseTokenCount` veio 22, 29 e 25
   * (por turno, não acumulado) e `promptTokenCount` veio 548, 588 e 635 — o
   * prompt inteiro recobrado a cada turno, que é como esses provedores cobram.
   * Guardar só o último valor perderia quase toda a conta.
   */
  private uso = { audioEntrada: 0, audioSaida: 0, textoEntrada: 0, textoSaida: 0, videoEntrada: 0 };
  private modelo = "";
  private relogioDoRelato: ReturnType<typeof setInterval> | null = null;
  private comecouEm = 0;

  constructor(private cb: RealtimeCallbacks = {}) {}

  async start(): Promise<void> {
    this.cb.onState?.("connecting");

    const sess: RespostaSessao = await fetch("/api/realtime/session", { method: "POST" }).then((r) => r.json());
    if (!sess.url || !sess.setup) throw new Error(sess.error ?? "sessão indisponível");

    // o microfone antes do socket: negar a permissão aqui não gasta uma sessão
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(sess.url!);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ setup: sess.setup }));
        resolve();
      };
      ws.onerror = () => reject(new Error("não consegui abrir a sessão de voz"));
      ws.onmessage = (e) => void this.receber(e.data);
      ws.onclose = () => {
        if (!this.fechando) this.cb.onState?.("closed");
      };
    });

    await this.ligarMicrofone();
    this.modelo = sess.model ?? "";
    this.comecouEm = Date.now();
    // relato periódico: uma aba fechada no tranco (ou a máquina dormindo) não
    // pode apagar uma hora de conversa da conta da casa
    this.relogioDoRelato = setInterval(() => void this.relatarUso(), INTERVALO_DO_RELATO);
    this.cb.onState?.("listening");
  }

  private async ligarMicrofone() {
    const ctx = new AudioContext({ sampleRate: TAXA_ENTRADA });
    this.micCtx = ctx;
    await ctx.audioWorklet.addModule(CAMINHO_WORKLET);
    const origem = ctx.createMediaStreamSource(this.stream!);
    const no = new AudioWorkletNode(ctx, "captura-pcm");
    this.no = no;
    no.port.onmessage = (e) => this.acumular(e.data as Float32Array, ctx.sampleRate);
    origem.connect(no);
    // o worklet não produz som; sem destino algum, o Chrome pode suspender o grafo
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    no.connect(mudo).connect(ctx.destination);
  }

  /** Junta os quadros de 128 amostras do worklet até fechar ~100 ms e então envia. */
  private acumular(quadro: Float32Array, taxa: number) {
    this.acumulado.push(quadro);
    this.amostras += quadro.length;
    const alvo = (taxa * MS_POR_ENVIO) / 1000;
    if (this.amostras < alvo) return;

    const junto = new Float32Array(this.amostras);
    let off = 0;
    for (const q of this.acumulado) { junto.set(q, off); off += q.length; }
    this.acumulado = [];
    this.amostras = 0;

    const pronto = reamostrar(junto, taxa, TAXA_ENTRADA);
    const pcm = new Int16Array(pronto.length);
    for (let i = 0; i < pronto.length; i++) {
      const v = Math.max(-1, Math.min(1, pronto[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        realtimeInput: { audio: { mimeType: `audio/pcm;rate=${TAXA_ENTRADA}`, data: paraBase64(new Uint8Array(pcm.buffer)) } },
      }),
    );
  }

  private async receber(dado: unknown) {
    const texto = typeof dado === "string" ? dado : dado instanceof Blob ? await dado.text() : "";
    let m: {
      serverContent?: {
        modelTurn?: { parts?: Array<{ inlineData?: { data?: string }; text?: string }> };
        inputTranscription?: { text?: string };
        outputTranscription?: { text?: string };
        turnComplete?: boolean;
        interrupted?: boolean;
      };
      toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: unknown }> };
      usageMetadata?: {
        promptTokenCount?: number;
        responseTokenCount?: number;
        promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
        responseTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
      };
    };
    try { m = JSON.parse(texto); } catch { return; }

    if (m.usageMetadata) this.somarUso(m.usageMetadata);

    const sc = m.serverContent;
    // barge-in: a pessoa voltou a falar por cima, então o que já foi agendado
    // não pode continuar tocando — senão a Órbita responde a duas perguntas ao mesmo tempo
    if (sc?.interrupted) this.pararFala();

    for (const p of sc?.modelTurn?.parts ?? []) {
      if (p.inlineData?.data) this.tocar(deBase64(p.inlineData.data));
    }
    if (sc?.inputTranscription?.text) this.transcricaoMinha += sc.inputTranscription.text;
    if (sc?.outputTranscription?.text) this.transcricaoDela += sc.outputTranscription.text;

    if (sc?.turnComplete) {
      // a transcrição chega picada; a tela só recebe a frase inteira, como no caminho da OpenAI
      if (this.transcricaoMinha.trim()) this.cb.onTranscript?.("user", this.transcricaoMinha.trim());
      if (this.transcricaoDela.trim()) this.cb.onTranscript?.("assistant", this.transcricaoDela.trim());
      this.transcricaoMinha = "";
      this.transcricaoDela = "";
      this.cb.onState?.("listening");
    }

    for (const fc of m.toolCall?.functionCalls ?? []) {
      if (fc.id && fc.name) void this.executarTool(fc.id, fc.name, fc.args);
    }
  }

  private tocar(pcm: Int16Array) {
    this.cb.onState?.("speaking");
    const ctx = (this.somCtx ??= new AudioContext());
    void ctx.resume();
    const buf = ctx.createBuffer(1, pcm.length, TAXA_SAIDA);
    const canal = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) canal[i] = pcm[i] / 0x8000;

    const fonte = ctx.createBufferSource();
    fonte.buffer = buf;
    fonte.connect(ctx.destination);
    // enfileira: cada pedaço começa onde o anterior termina, senão a fala sai picotada
    const agora = ctx.currentTime;
    this.proximoInicio = Math.max(this.proximoInicio, agora);
    fonte.start(this.proximoInicio);
    this.proximoInicio += buf.duration;
    this.tocando.add(fonte);
    fonte.onended = () => this.tocando.delete(fonte);
  }

  private pararFala() {
    for (const f of this.tocando) { try { f.stop(); } catch { /* já terminou */ } }
    this.tocando.clear();
    this.proximoInicio = 0;
  }

  /**
   * A tool roda no NOSSO servidor, nunca aqui: `/api/realtime/tool` resolve o
   * nome pelo registro e deriva o gate do risco (§5.1). É o que segura a
   * garantia mesmo com a config da sessão vindo do navegador.
   */
  private async chamar(nome: string, args: unknown): Promise<unknown> {
    try {
      const r = await fetch("/api/realtime/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, arguments: args ?? {}, deviceId: getOwnDeviceId() ?? undefined }),
      });
      const d = await r.json().catch(() => ({}));
      return r.ok ? d.result : { erro: d.error ?? "falha ao executar" };
    } catch {
      return { erro: "falha ao contatar o servidor" };
    }
  }

  private async executarTool(id: string, nome: string, args: unknown) {
    let saida = await this.chamar(nome, args);

    // A tool de câmera pede uma imagem quando não tem nenhuma recente. No chat
    // de texto isso vira um botão; aqui, em conversa por voz, não havia quem
    // atendesse o pedido — a Órbita recebia "preciso de imagem" e improvisava
    // uma resposta sem sentido ("não tenho acesso a streaming"). Agora o
    // próprio cliente de voz captura e refaz a chamada, já com o que olhar.
    const pedido = saida as { precisa_de_imagem?: boolean; camera_id?: string | null } | null;
    if (pedido?.precisa_de_imagem) {
      const daqui =
        pedido.camera_id === null || pedido.camera_id === undefined
          ? await garantirCameraDoAparelho()
          : ehCameraDesteAparelho(pedido.camera_id)
            ? pedido.camera_id
            : null;
      if (daqui && (await capturarUmQuadro(daqui))) saida = await this.chamar(nome, args);
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ id, name: nome, response: { result: saida } }] } }));
    }
    this.cb.onToolCall?.(nome, saida);
  }

  /**
   * Soma o que o Google cobrou por esta resposta.
   *
   * O detalhamento por modalidade é o que separa áudio (US$ 3/M na entrada) de
   * texto (US$ 0,75/M) e de imagem — preços diferentes na mesma conversa. Sem
   * ele a sessão viraria um número só, e o dono não saberia se foi a câmera
   * aberta que encareceu a hora ou a conversa em si.
   */
  private somarUso(u: {
    promptTokenCount?: number;
    responseTokenCount?: number;
    promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
    responseTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  }) {
    const entrada = u.promptTokensDetails ?? [];
    const saida = u.responseTokensDetails ?? [];

    for (const d of entrada) {
      const n = d.tokenCount ?? 0;
      if (d.modality === "AUDIO") this.uso.audioEntrada += n;
      else if (d.modality === "IMAGE" || d.modality === "VIDEO") this.uso.videoEntrada += n;
      else this.uso.textoEntrada += n;
    }
    for (const d of saida) {
      const n = d.tokenCount ?? 0;
      if (d.modality === "AUDIO") this.uso.audioSaida += n;
      else this.uso.textoSaida += n;
    }

    // provedor que não detalhar não pode sumir da conta: o total vira a
    // estimativa mais cara possível (tudo áudio), para o gasto nunca parecer
    // menor do que foi
    if (!entrada.length && u.promptTokenCount) this.uso.audioEntrada += u.promptTokenCount;
    if (!saida.length && u.responseTokenCount) this.uso.audioSaida += u.responseTokenCount;
  }

  /** Entrega o acumulado e zera. Zerar é o que torna o relato periódico seguro contra contar duas vezes. */
  private async relatarUso(): Promise<void> {
    const uso = this.uso;
    if (!uso.audioEntrada && !uso.audioSaida && !uso.textoEntrada && !uso.textoSaida && !uso.videoEntrada) return;
    this.uso = { audioEntrada: 0, audioSaida: 0, textoEntrada: 0, textoSaida: 0, videoEntrada: 0 };
    try {
      await fetch("/api/uso/sessao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true, // a aba pode estar fechando; sem isto o último relato morre com ela
        body: JSON.stringify({
          fluxo: "voz_tempo_real",
          provedor: "gemini",
          modelo: this.modelo || "gemini-live",
          ...uso,
          duracaoMs: this.comecouEm ? Date.now() - this.comecouEm : undefined,
        }),
      });
    } catch {
      // registrar gasto nunca pode atrapalhar a conversa (mesma regra do registrarUso no servidor)
    }
  }

  stop() {
    this.fechando = true;
    if (this.relogioDoRelato) clearInterval(this.relogioDoRelato);
    this.relogioDoRelato = null;
    void this.relatarUso();
    this.pararFala();
    this.no?.port.close();
    this.no?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.micCtx?.close();
    void this.somCtx?.close();
    try { this.ws?.close(); } catch { /* já fechado */ }
    this.ws = null;
    this.no = null;
    this.micCtx = null;
    this.somCtx = null;
    this.stream = null;
    this.acumulado = [];
    this.amostras = 0;
    this.cb.onState?.("closed");
  }

  get active(): boolean {
    return this.ws !== null;
  }
}
