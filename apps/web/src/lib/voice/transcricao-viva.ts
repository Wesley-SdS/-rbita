/**
 * Transcrição ao vivo da reunião pelo Gemini.
 *
 * Substitui a prévia da Web Speech quando o dono escolhe isso em Ajustes. As
 * duas diferenças que importam: funciona em qualquer navegador (a Web Speech
 * é só Chrome e Edge) e erra muito menos. O preço é ser cobrada por minuto de
 * áudio, e por isso NÃO é o padrão.
 *
 * ⚠️ Isto continua sendo PRÉVIA. A transcrição que vale, com separação de quem
 * falou, é feita no fim sobre a gravação inteira. Não é escolha de
 * implementação: medido em 22/09/2026, o Gemini Live aceita `diarization` no
 * setup e não devolve rótulo nenhum, e rótulo de locutor só é coerente quando
 * atribuído sobre o áudio todo de uma vez.
 */

const TAXA = 16000;
const MS_POR_ENVIO = 100;
const CAMINHO_WORKLET = "/audio/captura-pcm.js";

/** Reamostragem linear, igual à da conversa por voz: nem todo navegador honra o `sampleRate` pedido. */
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
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface TranscricaoVivaCallbacks {
  /** o texto corrido até agora (parcial enquanto se fala, assentado a cada trecho) */
  aoTexto: (texto: string) => void;
  aoFalhar?: (recado: string) => void;
}

export class TranscricaoViva {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private no: AudioWorkletNode | null = null;
  private acumulado: Float32Array[] = [];
  private amostras = 0;
  /** trechos já assentados; o parcial do trecho em curso vai depois deles */
  private firmado = "";
  private fechando = false;
  /**
   * A conta da prévia ao vivo.
   *
   * Este modelo é cobrado por SEGUNDO de áudio (~US$ 0,54/hora), não por
   * token, e o áudio vai do navegador direto ao Google. Então o que a casa
   * precisa saber é quanto tempo a sessão ficou aberta, e é isso que sobe
   * para /api/uso/sessao. Uma reunião de duas horas custa mais do que a
   * transcrição final dela: sem esta linha, isso não apareceria em lugar
   * nenhum.
   */
  private modelo = "";
  private relatadoAte = 0;
  private relogioDoRelato: ReturnType<typeof setInterval> | null = null;

  constructor(private cb: TranscricaoVivaCallbacks) {}

  get ativa(): boolean {
    return this.ws !== null;
  }

  /** `stream` é o MESMO da gravação: microfone mais áudio da tela, já misturados. */
  async iniciar(stream: MediaStream): Promise<void> {
    const sess: { url?: string; setup?: Record<string, unknown>; model?: string; error?: string } = await fetch("/api/meeting/live", { method: "POST" }).then((r) => r.json());
    if (!sess.url || !sess.setup) throw new Error(sess.error ?? "transcrição ao vivo indisponível");
    this.modelo = sess.model ?? "gemini-transcribe-live";
    this.relatadoAte = Date.now();

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(sess.url!);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ setup: sess.setup }));
        resolve();
      };
      ws.onerror = () => reject(new Error("não consegui abrir a transcrição ao vivo"));
      ws.onmessage = (e) => void this.receber(e.data);
      ws.onclose = () => {
        if (!this.fechando) {
          // caiu sozinha: o que já foi consumido precisa entrar na conta agora,
          // senão some junto com a sessão
          void this.relatarUso();
          this.cb.aoFalhar?.("A transcrição ao vivo caiu. A gravação continua, e o texto final não depende dela.");
        }
      };
    });

    // relato periódico: uma reunião de duas horas que termine com a aba
    // fechada no tranco não pode sumir inteira da conta
    this.relogioDoRelato = setInterval(() => void this.relatarUso(), 120_000);

    const ctx = new AudioContext({ sampleRate: TAXA });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(CAMINHO_WORKLET);
    const origem = ctx.createMediaStreamSource(stream);
    const no = new AudioWorkletNode(ctx, "captura-pcm");
    this.no = no;
    no.port.onmessage = (e) => this.acumular(e.data as Float32Array, ctx.sampleRate);
    origem.connect(no);
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    no.connect(mudo).connect(ctx.destination);
  }

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

    const pronto = reamostrar(junto, taxa, TAXA);
    const pcm = new Int16Array(pronto.length);
    for (let i = 0; i < pronto.length; i++) {
      const v = Math.max(-1, Math.min(1, pronto[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ realtimeInput: { audio: { mimeType: `audio/pcm;rate=${TAXA}`, data: paraBase64(new Uint8Array(pcm.buffer)) } } }));
  }

  private async receber(dado: unknown) {
    const texto = typeof dado === "string" ? dado : dado instanceof Blob ? await dado.text() : "";
    let m: { serverContent?: { interimInputTranscription?: { text?: string }; inputTranscription?: { text?: string } } };
    try { m = JSON.parse(texto); } catch { return; }
    const sc = m.serverContent;

    // O parcial vem CRESCENDO (repete tudo que já disse e acrescenta), então
    // ele substitui o parcial anterior em vez de ser concatenado — senão a
    // tela encheria de frases repetidas.
    const parcial = sc?.interimInputTranscription?.text;
    if (parcial) this.cb.aoTexto((this.firmado + " " + parcial).trim());

    const firme = sc?.inputTranscription?.text;
    if (firme) {
      this.firmado = firme.trim();
      this.cb.aoTexto(this.firmado);
    }
  }

  /** Sobe os segundos consumidos desde o último relato. Só o delta, para não contar duas vezes. */
  private async relatarUso(): Promise<void> {
    if (!this.relatadoAte) return;
    const segundos = Math.round((Date.now() - this.relatadoAte) / 1000);
    this.relatadoAte = Date.now();
    if (segundos <= 0) return;
    try {
      await fetch("/api/uso/sessao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ fluxo: "transcricao_viva", provedor: "gemini", modelo: this.modelo, segundos }),
      });
    } catch {
      // a conta nunca atrapalha a reunião
    }
  }

  parar(): void {
    this.fechando = true;
    if (this.relogioDoRelato) clearInterval(this.relogioDoRelato);
    this.relogioDoRelato = null;
    void this.relatarUso();
    this.no?.port.close();
    this.no?.disconnect();
    void this.ctx?.close();
    try { this.ws?.close(); } catch { /* já fechado */ }
    this.ws = null;
    this.no = null;
    this.ctx = null;
    this.acumulado = [];
    this.amostras = 0;
  }
}
