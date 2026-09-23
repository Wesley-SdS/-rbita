/**
 * Impede a tela de dormir enquanto o aparelho é um satélite.
 *
 * Não é conforto: quando o celular dorme, o navegador suspende o áudio e o
 * "Ei Órbita" para de escutar. Sem isto o satélite funciona por trinta
 * segundos e depois fica mudo sem avisar.
 *
 * O sistema SOLTA a trava sozinho toda vez que a aba vai para segundo plano ou
 * a tela é apagada à mão. Por isso não basta pedir uma vez: é preciso pedir de
 * novo quando a aba volta, e é esse detalhe que separa "funcionou no teste" de
 * "ainda estava ouvindo de manhã".
 */

type Sentinela = { released: boolean; release: () => Promise<void>; addEventListener: (t: string, f: () => void) => void };
type ComWakeLock = { wakeLock?: { request: (tipo: "screen") => Promise<Sentinela> } };

export class TelaAcesa {
  private trava: Sentinela | null = null;
  private ligado = false;
  private aoVoltar: (() => void) | null = null;

  get ativa(): boolean {
    return this.ligado && !!this.trava && !this.trava.released;
  }

  /** Devolve false quando o navegador não tem Wake Lock (a tela vai dormir). */
  async ligar(): Promise<boolean> {
    this.ligado = true;
    const ok = await this.pedir();

    if (!this.aoVoltar) {
      this.aoVoltar = () => {
        // `visible` e não `hidden`: pedir com a aba escondida é recusado
        if (this.ligado && document.visibilityState === "visible") void this.pedir();
      };
      document.addEventListener("visibilitychange", this.aoVoltar);
    }
    return ok;
  }

  async desligar(): Promise<void> {
    this.ligado = false;
    if (this.aoVoltar) {
      document.removeEventListener("visibilitychange", this.aoVoltar);
      this.aoVoltar = null;
    }
    try {
      await this.trava?.release();
    } catch {
      /* já solta */
    }
    this.trava = null;
  }

  private async pedir(): Promise<boolean> {
    const api = (navigator as unknown as ComWakeLock).wakeLock;
    if (!api) return false;
    if (this.trava && !this.trava.released) return true;
    try {
      this.trava = await api.request("screen");
      // o sistema pode soltar por conta própria (bateria, chamada): saber
      // disso é o que permite pedir de novo em vez de achar que está ativa
      this.trava.addEventListener("release", () => {
        if (this.trava?.released) this.trava = null;
      });
      return true;
    } catch {
      // recusa acontece em aba escondida e com bateria muito baixa
      return false;
    }
  }
}
