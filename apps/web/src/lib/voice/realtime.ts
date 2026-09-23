import { getOwnDeviceId } from "@/lib/device-id";

/** O que a tela precisa de uma sessão de voz, seja qual for o provedor. */
export interface SessaoRealtime {
  start(): Promise<void>;
  stop(): void;
  readonly active: boolean;
}

export interface RealtimeCallbacks {
  onState?: (state: "connecting" | "listening" | "speaking" | "closed") => void;
  onError?: (msg: string) => void;
  onTranscript?: (role: "user" | "assistant", text: string) => void;
  /** uma tool foi chamada durante a conversa por voz (B7.2 — ver packages/core/src/tools/index.ts:runRealtimeTool). */
  onToolCall?: (name: string, result: unknown) => void;
}

/**
 * Cliente WebRTC da OpenAI Realtime (voz S2S premium, baixa latência).
 * Fluxo: pega token efêmero do nosso backend → abre RTCPeerConnection direto
 * com a OpenAI → streama o mic e toca a resposta de áudio. Barge-in é nativo
 * (o modelo para de falar quando você fala).
 *
 * O irmão barato dele é o `GeminiLiveSession`; quem escolhe é o servidor.
 */
export class RealtimeSession implements SessaoRealtime {
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private dc: RTCDataChannel | null = null;
  /** call_id → nome da função, preenchido quando o item aparece; os argumentos chegam depois, em partes. */
  private pendingCalls = new Map<string, string>();
  /**
   * A conta desta sessão. O áudio vai por WebRTC direto para a OpenAI, então
   * o servidor não vê nada passar: quem conta é o `response.done`, que traz o
   * `usage` de cada resposta, e quem entrega é este cliente.
   *
   * Aqui o `usage` é por RESPOSTA (não acumulado), então soma-se cada evento.
   */
  private uso = { audioEntrada: 0, audioSaida: 0, textoEntrada: 0, textoSaida: 0 };
  private modelo = "";
  private comecouEm = 0;

  constructor(private cb: RealtimeCallbacks = {}) {}

  async start(): Promise<void> {
    this.cb.onState?.("connecting");

    // 1) token efêmero do nosso servidor (a chave real fica no backend)
    const sess = await fetch("/api/realtime/session", { method: "POST" }).then((r) => r.json());
    if (!sess.clientSecret) throw new Error(sess.error ?? "sessão indisponível");
    this.modelo = sess.model ?? "";
    this.comecouEm = Date.now();

    // 2) peer connection + áudio de saída
    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.audioEl = new Audio();
    this.audioEl.autoplay = true;
    pc.ontrack = (e) => { if (this.audioEl) this.audioEl.srcObject = e.streams[0]; };

    // 3) microfone
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream!));

    // 4) canal de eventos (transcrições, estado de fala)
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (e) => this.handleEvent(e.data);

    // 5) SDP offer → OpenAI (interface unificada /calls) → answer.
    //    Com o client secret efêmero, o browser fala direto com a OpenAI.
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const resp = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${sess.clientSecret}`, "Content-Type": "application/sdp" },
    });
    if (!resp.ok) throw new Error("falha no handshake WebRTC");
    const answer = { type: "answer" as const, sdp: await resp.text() };
    await pc.setRemoteDescription(answer);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.cb.onState?.("listening");
      else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) this.cb.onState?.("closed");
    };
  }

  private handleEvent(raw: string) {
    let ev: {
      type?: string;
      transcript?: string;
      delta?: string;
      call_id?: string;
      arguments?: string;
      item?: { type?: string; call_id?: string; name?: string };
      response?: {
        usage?: {
          input_token_details?: { audio_tokens?: number; text_tokens?: number };
          output_token_details?: { audio_tokens?: number; text_tokens?: number };
          input_tokens?: number;
          output_tokens?: number;
        };
      };
    };
    try { ev = JSON.parse(raw); } catch { return; }
    const t = ev.type ?? "";
    // aceita tanto os nomes da fase beta quanto os do GA (gpt-realtime)
    if (t === "input_audio_buffer.speech_started") this.cb.onState?.("listening");
    else if (t === "response.audio.delta" || t === "response.output_audio.delta") this.cb.onState?.("speaking");
    else if (t === "response.audio_transcript.done" || t === "response.output_audio_transcript.done") {
      if (ev.transcript) this.cb.onTranscript?.("assistant", ev.transcript);
    } else if (t === "conversation.item.input_audio_transcription.completed") {
      if (ev.transcript) this.cb.onTranscript?.("user", ev.transcript);
    } else if (t === "response.output_item.added" && ev.item?.type === "function_call" && ev.item.call_id && ev.item.name) {
      // B7.2: o nome da função chega aqui; os argumentos chegam depois, em partes, num evento próprio.
      this.pendingCalls.set(ev.item.call_id, ev.item.name);
    } else if (t === "response.function_call_arguments.done" && ev.call_id) {
      const name = this.pendingCalls.get(ev.call_id);
      this.pendingCalls.delete(ev.call_id);
      if (name) void this.executeFunctionCall(ev.call_id, name, ev.arguments ?? "{}");
    } else if (t === "response.done") {
      this.somarUso(ev.response?.usage);
    } else if (t === "error") {
      this.cb.onError?.("erro na sessão realtime");
    }
  }

  /**
   * Repassa a function call para o backend (`/api/realtime/tool`, que roda o
   * MESMO gate do chat de texto — o browser nunca executa uma tool sozinho)
   * e devolve o resultado pela sessão para o modelo continuar falando.
   */
  private async executeFunctionCall(callId: string, name: string, argsJson: string) {
    let args: unknown = {};
    try { args = JSON.parse(argsJson); } catch { /* argumentos vazios ou inválidos viram {} */ }
    let output: unknown;
    try {
      // deviceId: aparelho registrado em Casa → Aparelhos (Onda 12), diz "daqui" é onde.
      const r = await fetch("/api/realtime/tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, arguments: args, deviceId: getOwnDeviceId() ?? undefined }) });
      const d = await r.json().catch(() => ({}));
      output = r.ok ? d.result : { erro: d.error ?? "falha ao executar" };
    } catch {
      output = { erro: "falha ao contatar o servidor" };
    }
    this.dc?.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } }));
    this.dc?.send(JSON.stringify({ type: "response.create" }));
    this.cb.onToolCall?.(name, output);
  }

  /** Soma o que a OpenAI cobrou por esta resposta, separando áudio de texto (US$ 32/M contra US$ 4/M). */
  private somarUso(u?: {
    input_token_details?: { audio_tokens?: number; text_tokens?: number };
    output_token_details?: { audio_tokens?: number; text_tokens?: number };
    input_tokens?: number;
    output_tokens?: number;
  }) {
    if (!u) return;
    const ent = u.input_token_details;
    const sai = u.output_token_details;
    if (ent) {
      this.uso.audioEntrada += ent.audio_tokens ?? 0;
      this.uso.textoEntrada += ent.text_tokens ?? 0;
    } else if (u.input_tokens) {
      // sem detalhamento, assume o mais caro: nunca parecer mais barato do que foi
      this.uso.audioEntrada += u.input_tokens;
    }
    if (sai) {
      this.uso.audioSaida += sai.audio_tokens ?? 0;
      this.uso.textoSaida += sai.text_tokens ?? 0;
    } else if (u.output_tokens) {
      this.uso.audioSaida += u.output_tokens;
    }
  }

  private async relatarUso(): Promise<void> {
    const uso = this.uso;
    if (!uso.audioEntrada && !uso.audioSaida && !uso.textoEntrada && !uso.textoSaida) return;
    this.uso = { audioEntrada: 0, audioSaida: 0, textoEntrada: 0, textoSaida: 0 };
    try {
      await fetch("/api/uso/sessao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          fluxo: "voz_tempo_real",
          provedor: "openai",
          modelo: this.modelo || "gpt-realtime",
          ...uso,
          duracaoMs: this.comecouEm ? Date.now() - this.comecouEm : undefined,
        }),
      });
    } catch {
      // a conta não pode derrubar a conversa
    }
  }

  stop() {
    void this.relatarUso();
    this.dc?.close();
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audioEl) { this.audioEl.srcObject = null; this.audioEl = null; }
    this.pc = null;
    this.stream = null;
    this.dc = null;
    this.pendingCalls.clear();
    this.cb.onState?.("closed");
  }

  get active(): boolean {
    return this.pc !== null;
  }
}

/**
 * A sessão de voz do provedor que o servidor escolheu.
 *
 * Quem chama não sabe (nem precisa saber) se vai falar por WebRTC com a OpenAI
 * ou por WebSocket com o Gemini: a decisão é config do dono, resolvida no
 * servidor (`realtime.provider`), e as duas implementações têm a mesma
 * interface. O `import()` do Gemini é dinâmico porque ele carrega o código de
 * áudio (worklet, reamostragem) que a casa que usa OpenAI nunca vai baixar.
 */
export function criarSessaoRealtime(cb: RealtimeCallbacks = {}): SessaoRealtime {
  let interna: SessaoRealtime | null = null;
  return {
    async start() {
      const cfg: { provider?: string } = await fetch("/api/realtime/config").then((r) => r.json()).catch(() => ({}));
      interna = cfg.provider === "gemini" ? new (await import("./gemini-live")).GeminiLiveSession(cb) : new RealtimeSession(cb);
      await interna.start();
    },
    stop() {
      interna?.stop();
      interna = null;
    },
    get active() {
      return interna?.active ?? false;
    },
  };
}
