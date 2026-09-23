/**
 * O FORMATO QUE O CHAT FALA HOJE.
 *
 * O `/api/chat` deixou de mandar texto puro e passou a mandar NDJSON: uma
 * linha JSON por evento (`{"t":"text","v":"Olá"}`, `{"t":"tool","name":...}`).
 * O app continuou acumulando os bytes crus, então a resposta aparecia na tela
 * como o JSON literal. O app estava quebrado contra o servidor e ninguém
 * tinha percebido.
 *
 * Esta é a parte que decide, separada da rede para poder ser testada: o
 * streaming corta no meio de uma linha o tempo todo, e o pedaço incompleto
 * PRECISA esperar o resto em vez de virar lixo na tela.
 */

export type EventoDoChat =
  | { t: "text"; v: string }
  | { t: "tool"; name: string }
  | { t: "tool-done"; name: string }
  | { t: "error"; msg: string }
  | { t: string; [k: string]: unknown };

/**
 * Consome pedaços de rede e entrega eventos completos.
 *
 * Guarda a sobra entre chamadas: `{"t":"te` chega numa leitura e `xt","v":"oi"}`
 * na seguinte, e só a junção das duas é um evento.
 */
export class LeitorNdjson {
  private sobra = "";

  /** Os eventos completos que chegaram com este pedaço. */
  alimentar(pedaco: string): EventoDoChat[] {
    this.sobra += pedaco;
    const linhas = this.sobra.split("\n");
    // a última é a incompleta (ou vazia, quando o pedaço terminou no \n)
    this.sobra = linhas.pop() ?? "";

    const eventos: EventoDoChat[] = [];
    for (const linha of linhas) {
      if (!linha.trim()) continue;
      try {
        eventos.push(JSON.parse(linha) as EventoDoChat);
      } catch {
        // linha inválida não derruba o turno: o resto da resposta ainda vale
      }
    }
    return eventos;
  }

  /** O que sobrou no fim do stream, quando o servidor não fechou com quebra de linha. */
  fim(): EventoDoChat[] {
    const resto = this.sobra.trim();
    this.sobra = "";
    if (!resto) return [];
    try {
      return [JSON.parse(resto) as EventoDoChat];
    } catch {
      return [];
    }
  }
}

/** Só o texto, que é o que a tela do chat mostra. */
export function textoDoEvento(ev: EventoDoChat): string {
  return ev.t === "text" && typeof ev.v === "string" ? ev.v : "";
}
