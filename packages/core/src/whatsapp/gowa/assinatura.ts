import { createHmac, timingSafeEqual } from "node:crypto";

export const ASSINATURA_HEADER = "x-hub-signature-256";

/**
 * Verificação da assinatura do webhook do GOWA (HMAC-SHA-256), portada do
 * `whatsapp-workspace`. Três cuidados que fazem diferença de verdade:
 *
 * 1. O HMAC é calculado sobre os BYTES CRUS. Se o corpo passar por
 *    `JSON.parse` e voltar por `JSON.stringify`, a ordem das chaves e o
 *    espaçamento mudam e a assinatura nunca bate. Por isso o `main.ts` guarda
 *    o corpo cru desta rota antes do body-parser.
 * 2. Comparação em tempo constante: `===` vaza, pelo tempo de resposta,
 *    quantos bytes iniciais estão certos.
 * 3. Falha fechada: ausente, malformada ou de tamanho diferente é recusa.
 */
export function assinaturaValida(corpoCru: Uint8Array, cabecalho: string | null | undefined, segredo: string): boolean {
  if (!cabecalho || !segredo) return false;
  const recebida = cabecalho.startsWith("sha256=") ? cabecalho.slice("sha256=".length) : cabecalho;
  if (!/^[0-9a-f]+$/i.test(recebida)) return false;
  const esperada = createHmac("sha256", segredo).update(corpoCru).digest();
  const r = Buffer.from(recebida, "hex");
  if (r.length !== esperada.length) return false;
  return timingSafeEqual(r, esperada);
}

/** Só para testes e para a sondagem: assina como o GOWA assinaria. */
export function assinar(corpoCru: Uint8Array | string, segredo: string): string {
  return "sha256=" + createHmac("sha256", segredo).update(corpoCru).digest("hex");
}
