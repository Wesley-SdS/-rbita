import { decryptSecret, encryptSecret } from "../crypto";

/**
 * Cabeçalhos de autenticação de um servidor MCP, cifrados em repouso (§5.4).
 *
 * A coluna `mcp_server.headers` nasceu guardando o objeto em texto puro: um
 * `Authorization: Bearer ...` ficava legível em qualquer backup do banco. Agora
 * vai como `{ cifrado: "v1:..." }`. A leitura ainda aceita o formato antigo,
 * para servidor cadastrado antes continuar conectando até ser salvo de novo.
 */

const CHAVE = "cifrado";

export function guardarCabecalhos(h: Record<string, string> | null | undefined): { [CHAVE]: string } | null {
  if (!h || !Object.keys(h).length) return null;
  return { [CHAVE]: encryptSecret(JSON.stringify(h)) };
}

export function lerCabecalhos(guardado: unknown): Record<string, string> | null {
  if (!guardado || typeof guardado !== "object" || Array.isArray(guardado)) return null;
  const o = guardado as Record<string, unknown>;
  let bruto: unknown = o;
  if (typeof o[CHAVE] === "string") {
    try {
      bruto = JSON.parse(decryptSecret(o[CHAVE] as string));
    } catch {
      // chave de cifra trocada ou valor adulterado: sem cabeçalho o servidor
      // responde 401 e a tela mostra o erro, em vez de o api cair
      return null;
    }
  }
  if (!bruto || typeof bruto !== "object") return null;
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) if (typeof v === "string") saida[k] = v;
  return Object.keys(saida).length ? saida : null;
}

/** Os NOMES dos cabeçalhos, para a tela dizer o que está configurado sem mostrar o valor. */
export function nomesDosCabecalhos(guardado: unknown): string[] {
  return Object.keys(lerCabecalhos(guardado) ?? {});
}
