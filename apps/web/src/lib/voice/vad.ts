/**
 * QUANDO A PESSOA COMEÇOU E QUANDO PAROU DE FALAR.
 *
 * O detector antigo era uma linha: `rms > 0.02`. Volume acima do número é
 * fala, abaixo é silêncio. Isso falha nos dois sentidos, e os dois acontecem
 * numa casa de verdade:
 *
 *   - PARA MENOS: quem fala baixo, ou de dois metros do notebook, nunca passa
 *     do limiar. A Órbita corta no meio da frase, ou nem começa a ouvir.
 *   - PARA MAIS: ventilador, ar-condicionado, televisão e chuva passam de
 *     0,02 o tempo todo. Ela acha que você ainda está falando e nunca responde.
 *
 * E o 0,02 era CONSTANTE no código, então um quarto silencioso e uma cozinha
 * com exaustor tinham de caber no mesmo número (viola §5.6).
 *
 * Este arquivo é a decisão, separada de QUEM mede. A medida pode vir do modelo
 * silero (uma rede que reconhece voz humana) ou da energia adaptativa (sem
 * dependência nenhuma). A decisão é a mesma, e é ela que precisa de teste:
 * errar aqui é a Órbita cortando a fala do dono.
 */

export interface LimiaresDeFala {
  /** acima disso, um quadro é fala */
  iniciar: number;
  /** já falando, só para quando cai abaixo disto (histerese) */
  manter: number;
  /** silêncio contínuo que encerra a captura */
  silencioMs: number;
  /** fala curta demais é estalo, não fala */
  minFalaMs: number;
  /** teto absoluto de gravação */
  maxMs: number;
}

export const LIMIARES_PADRAO: LimiaresDeFala = {
  iniciar: 0.5,
  manter: 0.35,
  silencioMs: 1200,
  minFalaMs: 160,
  maxMs: 12000,
};

export type EstadoDaFala = "esperando" | "falando" | "terminou" | "estourou";

/**
 * A máquina de estados da captura.
 *
 * A HISTERESE é o ponto: começar em 0,5 e só parar abaixo de 0,35. Com um
 * limiar só, a probabilidade oscilando em volta dele pica a fala em pedaços e
 * a Órbita responde a meia frase. Dois limiares fazem a decisão grudar.
 */
export class DetectorDeFala {
  private comecouEm = 0;
  private ultimaFala = 0;
  private falando = false;
  private estado: EstadoDaFala = "esperando";

  constructor(
    private lim: LimiaresDeFala = LIMIARES_PADRAO,
    private iniciadoEm = 0,
  ) {
    this.ultimaFala = iniciadoEm;
  }

  /** Um quadro. `prob` de 0 a 1, `agora` em milissegundos. */
  alimentar(prob: number, agora: number): EstadoDaFala {
    if (this.estado === "terminou" || this.estado === "estourou") return this.estado;

    const limite = this.falando ? this.lim.manter : this.lim.iniciar;
    if (prob >= limite) {
      if (!this.falando) {
        this.falando = true;
        this.comecouEm = agora;
      }
      this.ultimaFala = agora;
      // só vira "falando" depois de durar o bastante: um estalo de porta dá um
      // quadro alto e acordaria a captura à toa
      if (agora - this.comecouEm >= this.lim.minFalaMs) this.estado = "falando";
    } else {
      this.falando = false;
    }

    if (agora - this.iniciadoEm > this.lim.maxMs) {
      // estourou o teto: o que foi gravado pode valer, quem chama decide
      this.estado = "estourou";
      return this.estado;
    }
    if (this.estado === "falando" && agora - this.ultimaFala > this.lim.silencioMs) {
      this.estado = "terminou";
    }
    return this.estado;
  }

  /** A pessoa chegou a falar alguma coisa? */
  get houveFala(): boolean {
    return this.estado === "falando" || this.estado === "terminou";
  }
}

/**
 * Probabilidade de fala a partir da ENERGIA, com piso de ruído aprendido.
 *
 * É a reserva de quando o modelo não carrega. Muito melhor que o limiar fixo
 * porque o piso é medido no próprio ambiente: numa cozinha com exaustor o piso
 * sobe, e o exaustor deixa de ser confundido com voz. O preço é não distinguir
 * VOZ de outro som forte, que é justamente o que o silero faz.
 */
export class EnergiaAdaptativa {
  private piso = 0;
  private amostras = 0;

  /** Quantos quadros medem o silêncio antes de valer a decisão (~300 ms a 100 ms/quadro). */
  constructor(private quadrosDeCalibragem = 3) {}

  prob(rms: number): number {
    if (this.amostras < this.quadrosDeCalibragem) {
      // a calibragem usa o MAIOR dos primeiros quadros: pegar a média deixaria
      // um ruído intermitente (ventilador que liga) por cima do piso depois
      this.piso = Math.max(this.piso, rms);
      this.amostras++;
      return 0;
    }
    // a fala precisa passar do piso com folga; o `+0.004` evita que um ambiente
    // perfeitamente silencioso (piso ~0) transforme qualquer sussurro em fala
    const limite = this.piso * 2.2 + 0.004;
    if (rms <= limite) return 0;
    // acima do limite, cresce rápido até 1: não precisa de precisão, precisa
    // de uma resposta estável para a histerese decidir
    return Math.min(1, (rms - limite) / (limite * 1.5 + 0.01));
  }

  /** O piso aprendido, para a tela poder mostrar por que ela não está ouvindo. */
  get pisoDeRuido(): number {
    return this.piso;
  }
}
