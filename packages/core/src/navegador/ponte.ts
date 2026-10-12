import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

/**
 * O SEGREDO DA PONTE de native messaging (B7, I-14 da auditoria).
 *
 * Antes a ponte se anunciava com `x-orbita-ponte: 1`, um cabeçalho que
 * qualquer processo desta máquina sabe mandar: sem Origin e com ele, um
 * programa qualquer chegava ao canal, e até ao PAREAMENTO, mesmo com o ID da
 * extensão configurado. Agora a ponte prova quem é com um segredo de arquivo,
 * gerado pelo instalador (`apps/extensao-chrome/ponte/instalar.mjs`) com
 * permissão só para o usuário do Windows que a instalou (icacls). O api e a
 * ponte leem o MESMO arquivo; quem não lê o arquivo não fala como ponte.
 *
 * Onde mora: `ORBITA_PONTE_SEGREDO` (caminho do arquivo) ou a pasta da Órbita
 * em AppData. O instalador usa a mesma regra (está repetida lá, em JS puro).
 */

export function caminhoDoSegredoDaPonte(env: Record<string, string | undefined> = process.env): string {
  if (env.ORBITA_PONTE_SEGREDO) return env.ORBITA_PONTE_SEGREDO;
  return join(env.LOCALAPPDATA ?? env.HOME ?? ".", "Orbita", "ponte", "segredo");
}

let cache: { caminho: string; mtime: number; valor: string | null } | null = null;

/** O segredo atual, relido quando o arquivo muda (o instalador pode girar o segredo com o api de pé). */
export function segredoDaPonte(env: Record<string, string | undefined> = process.env): string | null {
  const caminho = caminhoDoSegredoDaPonte(env);
  try {
    if (!existsSync(caminho)) return null;
    const mtime = statSync(caminho).mtimeMs;
    if (cache && cache.caminho === caminho && cache.mtime === mtime) return cache.valor;
    const v = readFileSync(caminho, "utf8").trim();
    const valor = /^[A-Za-z0-9_-]{32,200}$/.test(v) ? v : null;
    cache = { caminho, mtime, valor };
    return valor;
  } catch {
    return null;
  }
}

/** O valor que veio no cabeçalho é o segredo? Tempo constante; sem segredo no disco, nada passa. Puro sobre o valor lido. */
export function segredoConfere(recebido: string | null | undefined, esperado: string | null): boolean {
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Só para testes. */
export function _esquecerSegredoDaPonte(): void {
  cache = null;
}

/** O instalador da ponte, o MESMO que o README manda rodar à mão (idempotente). */
export const INSTALADOR_DA_PONTE = fileURLToPath(new URL("../../../../apps/extensao-chrome/ponte/instalar.mjs", import.meta.url));

export interface EstadoDaPonte {
  /** registrada no HKCU do Chrome */
  instalada: boolean;
  /** o arquivo do segredo existe */
  segredo: boolean;
  /** o manifesto do host está no disco */
  manifesto: boolean;
}

type Rodar = (args: string[]) => Promise<string>;
const rodarDeVerdade: Rodar = (args) =>
  new Promise((resolve, reject) => {
    execFile(process.execPath, [INSTALADOR_DA_PONTE, ...args], { timeout: 20_000, windowsHide: true }, (e, stdout, stderr) => (e ? reject(new Error((stderr || e.message).slice(0, 300))) : resolve(stdout)));
  });

/** O estado da ponte para a tela, perguntado ao próprio instalador (`--estado`). */
export async function estadoDaPonte(rodar: Rodar = rodarDeVerdade): Promise<EstadoDaPonte> {
  if (process.platform !== "win32") return { instalada: false, segredo: false, manifesto: false };
  const saida = await rodar(["--estado"]);
  const j = JSON.parse(saida.trim().split("\n").at(-1) ?? "{}") as Partial<EstadoDaPonte>;
  return { instalada: !!j.instalada, segredo: !!j.segredo, manifesto: !!j.manifesto };
}

/** Instala ou remove pela tela (a rota tem OwnerGuard): roda o instalador e devolve o estado depois. */
export async function mudarPonte(acao: "instalar" | "remover", rodar: Rodar = rodarDeVerdade): Promise<EstadoDaPonte> {
  if (process.platform !== "win32") throw new Error("A ponte de native messaging só existe no Windows.");
  await rodar(acao === "remover" ? ["--remover"] : []);
  _esquecerSegredoDaPonte();
  return estadoDaPonte(rodar);
}
