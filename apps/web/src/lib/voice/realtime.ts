/**
 * Cliente WebRTC da OpenAI Realtime (voz S2S premium, baixa latência).
 * Fluxo: pega token efêmero do nosso backend → abre RTCPeerConnection direto
 * com a OpenAI → streama o mic e toca a resposta de áudio. Barge-in é nativo
 * (o modelo para de falar quando você fala).
 */
export interface RealtimeCallbacks {
  onState?: (state: "connecting" | "listening" | "speaking" | "closed") => void;
  onError?: (msg: string) => void;
  onTranscript?: (role: "user" | "assistant", text: string) => void;
}

export class RealtimeSession {
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private dc: RTCDataChannel | null = null;

  constructor(private cb: RealtimeCallbacks = {}) {}

  async start(): Promise<void> {
    this.cb.onState?.("connecting");

    // 1) token efêmero do nosso servidor (a chave real fica no backend)
    const sess = await fetch("/api/realtime/session", { method: "POST" }).then((r) => r.json());
    if (!sess.clientSecret) throw new Error(sess.error ?? "sessão indisponível");

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
    let ev: { type?: string; transcript?: string; delta?: string };
    try { ev = JSON.parse(raw); } catch { return; }
    const t = ev.type ?? "";
    // aceita tanto os nomes da fase beta quanto os do GA (gpt-realtime)
    if (t === "input_audio_buffer.speech_started") this.cb.onState?.("listening");
    else if (t === "response.audio.delta" || t === "response.output_audio.delta") this.cb.onState?.("speaking");
    else if (t === "response.audio_transcript.done" || t === "response.output_audio_transcript.done") {
      if (ev.transcript) this.cb.onTranscript?.("assistant", ev.transcript);
    } else if (t === "conversation.item.input_audio_transcription.completed") {
      if (ev.transcript) this.cb.onTranscript?.("user", ev.transcript);
    } else if (t === "error") {
      this.cb.onError?.("erro na sessão realtime");
    }
  }

  stop() {
    this.dc?.close();
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audioEl) { this.audioEl.srcObject = null; this.audioEl = null; }
    this.pc = null;
    this.stream = null;
    this.dc = null;
    this.cb.onState?.("closed");
  }

  get active(): boolean {
    return this.pc !== null;
  }
}
