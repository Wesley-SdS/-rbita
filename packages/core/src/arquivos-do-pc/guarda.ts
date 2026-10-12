import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { settings } from "../settings";
import { dentroDe, expandirCaminho, normalizar, padraoNegado, pastaQueContem, pastasDeDadosDaOrbita, SEMPRE_NEGADOS } from "../maos/pastas";

/**
 * A GUARDA dos arquivos do PC (PRD A4): todo caminho que as tools de arquivo
 * tocam passa por aqui ANTES de qualquer leitura ou escrita.
 *
 *   1. dentro de `arquivos.pastas`, comparado depois de resolver `..`;
 *   2. o caminho REAL (`fs.realpath`: link simbólico e junção seguidos) também
 *      tem de cair dentro de uma pasta liberada. Um link em Documentos que
 *      aponta para C:\Windows não escapa;
 *   3. nenhum pedaço do caminho pedido nem do real casa com `arquivos.negados`
 *      (mais os de sempre: `.env*`, `.ssh`, chave privada, `.mcp.json`);
 *   4. nunca dentro das pastas de dados da própria Órbita.
 *
 * Quem não existe ainda (escrever arquivo novo) é conferido pela pasta-mãe,
 * que tem de existir e passar pelas mesmas regras.
 */

export class CaminhoRecusado extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaminhoRecusado";
  }
}

export interface RegrasDeArquivo {
  pastas: string[];
  negados: string[];
}

export async function regrasDeArquivo(): Promise<RegrasDeArquivo> {
  const c = await settings.getMany(["arquivos.pastas", "arquivos.negados"]);
  return { pastas: c["arquivos.pastas"], negados: [...SEMPRE_NEGADOS, ...c["arquivos.negados"]] };
}

/** As regras puras sobre um caminho já absoluto. Devolve o motivo da recusa ou null. */
export function motivoDaRecusa(absoluto: string, r: RegrasDeArquivo): string | null {
  if (!pastaQueContem(absoluto, r.pastas)) return "Esse caminho está fora das pastas que a Órbita pode usar (Ajustes, Controle do PC).";
  const negado = padraoNegado(absoluto, r.negados);
  if (negado) return `Esse arquivo é protegido (${negado}): a Órbita nunca lê nem escreve.`;
  const n = absoluto.toLowerCase();
  for (const d of pastasDeDadosDaOrbita()) if (dentroDe(n, normalizar(d))) return "Essa pasta é dos dados da própria Órbita: as mãos não mexem nela.";
  return null;
}

export interface CaminhoConferido {
  /** como foi pedido, absoluto */
  pedido: string;
  /** o real, com link resolvido (é este que se lê e escreve) */
  real: string;
  existe: boolean;
  tipo: "arquivo" | "pasta" | null;
  tamanho: number;
  modificadoEm: string | null;
}

/** Confere e devolve o caminho real. `novo`: pode não existir (a pasta-mãe tem de existir). */
export async function conferirCaminho(caminho: string, opts: { novo?: boolean; regras?: RegrasDeArquivo } = {}): Promise<CaminhoConferido> {
  const r = opts.regras ?? (await regrasDeArquivo());
  const exp = expandirCaminho(caminho);
  if (!path.win32.isAbsolute(exp)) throw new CaminhoRecusado("Use o caminho completo (pode começar com ~).");
  const pedido = path.win32.resolve(exp);
  const m1 = motivoDaRecusa(pedido, r);
  if (m1) throw new CaminhoRecusado(m1);

  let real: string;
  let existe = true;
  try {
    real = await realpath(pedido);
  } catch {
    if (!opts.novo) throw new CaminhoRecusado(`Não achei ${caminho}.`);
    existe = false;
    let mae: string;
    try {
      mae = await realpath(path.win32.dirname(pedido));
    } catch {
      throw new CaminhoRecusado("A pasta onde o arquivo iria não existe.");
    }
    real = path.win32.join(mae, path.win32.basename(pedido));
  }
  const m2 = motivoDaRecusa(real, r);
  if (m2) throw new CaminhoRecusado(m2 === "Esse caminho está fora das pastas que a Órbita pode usar (Ajustes, Controle do PC)." ? "Esse caminho é um atalho (link) que aponta para fora das pastas liberadas." : m2);

  if (!existe) return { pedido, real, existe, tipo: null, tamanho: 0, modificadoEm: null };
  const st = await stat(real);
  return { pedido, real, existe, tipo: st.isDirectory() ? "pasta" : "arquivo", tamanho: st.size, modificadoEm: st.mtime.toISOString() };
}
