/**
 * O silero-vad rodando no navegador.
 *
 * É uma rede minúscula (1,8 MB) treinada para distinguir VOZ HUMANA de
 * qualquer outro som. A energia, por melhor que seja o piso adaptativo, só
 * sabe dizer "tem som forte": televisão ligada e música passam por fala. O
 * silero não se engana com isso.
 *
 * Roda no cliente de propósito. Mandar o áudio para o serviço Python para
 * decidir quando a pessoa parou de falar somaria uma ida e volta de rede a
 * cada 30 ms, e o "Ei Órbita" deixaria de funcionar com o serviço fora do ar.
 *
 * O modelo e o runtime são servidos de `/modelos` (arquivos locais, não CDN):
 * a casa precisa funcionar sem internet, que é o princípio do projeto.
 */

/** Quadro que o silero espera a 16 kHz. Valor do modelo, não escolha nossa. */
export const AMOSTRAS_POR_QUADRO = 1536;
const TAXA = 16000;

type Tensor = { data: Float32Array | BigInt64Array; dims: number[] };
type Sessao = { run: (feeds: Record<string, unknown>) => Promise<Record<string, Tensor>> };

/**
 * Carrega o modelo uma vez por aba.
 *
 * Devolve `null` em vez de lançar quando não dá: sem WebAssembly, sem o
 * arquivo, ou num navegador que recusa. A voz então cai para a energia
 * adaptativa, que é pior mas funciona. Deixar o "Ei Órbita" morrer porque um
 * modelo não baixou seria trocar um problema por um maior.
 */
let carregando: Promise<DetectorSilero | null> | null = null;

export function carregarSilero(): Promise<DetectorSilero | null> {
  carregando ??= criar().catch(() => null);
  return carregando;
}

async function criar(): Promise<DetectorSilero | null> {
  if (typeof window === "undefined" || typeof WebAssembly === "undefined") return null;
  const ort = await import("onnxruntime-web");
  // sem isto o runtime busca o .wasm no CDN da Microsoft, e a casa offline
  // ficaria sem VAD
  ort.env.wasm.wasmPaths = "/modelos/";
  // uma thread: o ganho de várias exige cabeçalhos de isolamento cruzado
  // (COOP/COEP), que quebrariam o áudio e os iframes do resto do app
  ort.env.wasm.numThreads = 1;

  const sessao = (await ort.InferenceSession.create("/modelos/silero_vad.onnx", {
    executionProviders: ["wasm"],
  })) as unknown as Sessao;

  return new DetectorSilero(sessao, ort);
}

type OrtModule = typeof import("onnxruntime-web");

export class DetectorSilero {
  /** Estado recorrente do modelo: é ele que dá memória entre quadros. */
  private h: Float32Array;
  private c: Float32Array;

  constructor(
    private sessao: Sessao,
    private ort: OrtModule,
  ) {
    this.h = new Float32Array(2 * 64);
    this.c = new Float32Array(2 * 64);
  }

  /** Zera a memória entre uma captura e outra, senão a fala anterior contamina a próxima. */
  reiniciar(): void {
    this.h = new Float32Array(2 * 64);
    this.c = new Float32Array(2 * 64);
  }

  /** Probabilidade de fala (0 a 1) para um quadro de `AMOSTRAS_POR_QUADRO` a 16 kHz. */
  async prob(quadro: Float32Array): Promise<number> {
    const T = this.ort.Tensor;
    const saida = await this.sessao.run({
      input: new T("float32", quadro, [1, quadro.length]),
      sr: new T("int64", BigInt64Array.from([BigInt(TAXA)]), []),
      h: new T("float32", this.h, [2, 1, 64]),
      c: new T("float32", this.c, [2, 1, 64]),
    });
    this.h = saida.hn!.data as Float32Array;
    this.c = saida.cn!.data as Float32Array;
    return (saida.output!.data as Float32Array)[0] ?? 0;
  }
}

/**
 * Reamostra para 16 kHz, que é a única taxa que o modelo aceita.
 *
 * Interpolação linear basta: o silero decide sobre a forma da onda da voz, e
 * o erro de uma reamostragem simples fica muito abaixo do que ele distingue.
 * Um reamostrador melhor custaria CPU a cada 96 ms sem mudar a decisão.
 */
export function para16k(entrada: Float32Array, taxaOriginal: number): Float32Array {
  if (taxaOriginal === TAXA) return entrada;
  const razao = taxaOriginal / TAXA;
  const saida = new Float32Array(Math.floor(entrada.length / razao));
  for (let i = 0; i < saida.length; i++) {
    const pos = i * razao;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, entrada.length - 1);
    const t = pos - a;
    saida[i] = entrada[a]! * (1 - t) + entrada[b]! * t;
  }
  return saida;
}
