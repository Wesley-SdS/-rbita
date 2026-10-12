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

/**
 * O arquivo tem senha e nenhuma das cadastradas abriu. É um "não consegui ler"
 * (a fila não retenta: tentar de novo dá o mesmo resultado até o dono cadastrar
 * a senha na tela), com a mensagem que diz onde cadastrar.
 *
 * A senha nunca aparece na mensagem: este texto vai para o modelo, para o
 * histórico e para a tela de trabalhos.
 */
export class ArquivoProtegidoError extends DocumentoIlegivelError {
  constructor(message = "Este arquivo tem senha. Cadastre a senha do remetente em Ajustes, Anexos, e peça de novo.") {
    super(message);
    this.name = "ArquivoProtegidoError";
  }
}

/** Data URL "data:image/png;base64,..." → bytes + mime. */
export function lerDataUrl(dataUrl: string): { bytes: Buffer; mime: string } | null {
  const m = /^data:([\w/+.-]+)(?:;[\w=.-]+)*;base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  return { bytes: Buffer.from(m[2]!, "base64"), mime: m[1]! };
}
