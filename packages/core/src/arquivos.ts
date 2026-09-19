/**
 * Peças comuns a quem recebe arquivo do dono (documento, cupom, extrato).
 *
 * Moradia neutra de propósito: o erro de "não consegui ler" nasceu dentro de
 * finanças e passou a ser lançado também pela leitura de documento e pela fila.
 * Duas classes com o mesmo nome em módulos diferentes fariam o `instanceof` da
 * fila falhar para uma delas, e o trabalho seria retentado para sempre em vez
 * de parar como erro permanente.
 */

export class DocumentoIlegivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentoIlegivelError";
  }
}

/** Data URL "data:image/png;base64,..." → bytes + mime. */
export function lerDataUrl(dataUrl: string): { bytes: Buffer; mime: string } | null {
  const m = /^data:([\w/+.-]+)(?:;[\w=.-]+)*;base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  return { bytes: Buffer.from(m[2]!, "base64"), mime: m[1]! };
}
