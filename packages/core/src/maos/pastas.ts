import path from "node:path";
import os from "node:os";

/**
 * PASTAS LIBERADAS E ARQUIVOS NEGADOS (PRD A2, A4), em regras puras.
 *
 * Toda decisão de caminho do terminal e dos arquivos passa por aqui, com a
 * semântica do Windows (`path.win32`: sem caixa, `\` e `/` iguais):
 *   - `~` vira a pasta do usuário, e `/c/Users/...` (Git Bash) vira `C:\Users\...`;
 *   - "dentro" é dentro de verdade: `C:\github-falso` não está dentro de `C:\github`,
 *     e `..` é resolvido antes de comparar;
 *   - um padrão NEGADO vale mesmo dentro de uma pasta liberada. Padrão sem barra
 *     casa com qualquer pedaço do caminho (`.ssh` pega `~/.ssh/config`); com barra,
 *     casa com o fim do caminho (`*\/Google/Chrome/User Data`).
 *
 * Link simbólico e junção não se resolvem aqui (isto é puro): quem lê o disco
 * confere o caminho REAL (`fs.realpath`) com as mesmas funções, em `arquivos/guarda.ts`.
 */

const W = path.win32;

export function pastaDoUsuario(): string {
  return process.env.USERPROFILE || os.homedir();
}

/** "~/Documents" -> "C:\Users\fulano\Documents"; "/c/x" -> "C:\x"; relativo fica relativo. */
export function expandirCaminho(p: string, home = pastaDoUsuario()): string {
  let s = (p ?? "").trim().replace(/^["']|["']$/g, "");
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = W.join(home, s.slice(1));
  else if (/^\$(env:)?(USERPROFILE|HOME)([\\/]|$)/i.test(s)) s = W.join(home, s.replace(/^\$(env:)?(USERPROFILE|HOME)/i, ""));
  else if (/^%USERPROFILE%([\\/]|$)/i.test(s)) s = W.join(home, s.slice("%USERPROFILE%".length));
  const msys = /^\/([a-zA-Z])(\/|$)(.*)$/.exec(s);
  if (msys) s = `${msys[1]!.toUpperCase()}:\\${msys[3]!.replace(/\//g, "\\")}`;
  return s;
}

/** Caminho absoluto no Windows (com letra de unidade, UNC ou `\` na raiz). */
export function ehAbsoluto(p: string): boolean {
  return W.isAbsolute(p) || /^[a-zA-Z]:/.test(p);
}

export function ehUnc(p: string): boolean {
  return /^(\\\\|\/\/)[^\\/]+[\\/]/.test(p.trim()) || /^\\\\\?\\UNC\\/i.test(p.trim());
}

/** Resolve contra `base` e normaliza: "C:\a\b\..\c" -> "c:\a\c" (minúsculo, para comparar). */
export function normalizar(p: string, base?: string, home?: string): string {
  const e = expandirCaminho(p, home);
  const abs = ehAbsoluto(e) ? W.resolve(e) : W.resolve(base ?? process.cwd(), e);
  return semBarraNoFim(abs).toLowerCase();
}

/** `alvo` está dentro de `raiz` (ou é ela)? Os dois já normalizados. */
export function dentroDe(alvo: string, raiz: string): boolean {
  const r = semBarraNoFim(raiz);
  return alvo === r || alvo.startsWith(r + "\\");
}

/** Em qual pasta liberada o caminho cai (normalizada), ou null. */
export function pastaQueContem(caminho: string, pastas: readonly string[], base?: string, home?: string): string | null {
  const alvo = normalizar(caminho, base, home);
  for (const p of pastas) {
    if (!p.trim()) continue;
    const raiz = normalizar(p, undefined, home);
    if (dentroDe(alvo, raiz)) return raiz;
  }
  return null;
}

/**
 * O texto casa com o curinga (`*` qualquer sequência, `?` um caractere)? Sem
 * regex: o curinga vira `.*` e um padrão como `*a*a*a*…*b` contra um nome
 * comprido faz a regex tentar todas as combinações (exponencial no número de
 * `*`). Aqui é o algoritmo guloso de uma estrela só, que volta no máximo ao
 * último `*`: O(texto × padrão) no pior caso. Os dois já em minúsculas.
 */
export function casaCuringa(texto: string, padrao: string): boolean {
  let t = 0;
  let p = 0;
  let estrela = -1;
  let marca = 0;
  while (t < texto.length) {
    const pc = padrao[p];
    if (p < padrao.length && pc !== "*" && (pc === "?" || pc === texto[t])) {
      t++;
      p++;
    } else if (p < padrao.length && pc === "*") {
      estrela = p++;
      marca = t;
    } else if (estrela !== -1) {
      p = estrela + 1;
      t = ++marca;
    } else {
      return false;
    }
  }
  while (p < padrao.length && padrao[p] === "*") p++;
  return p === padrao.length;
}

/** Tira as barras do fim sem regex (a regex de barras no fim volta a cada barra de uma corrida longa). */
export function semBarraNoFim(s: string): string {
  let k = s.length;
  while (k > 0 && (s[k - 1] === "/" || s[k - 1] === "\\")) k--;
  return k === s.length ? s : s.slice(0, k);
}

/**
 * O caminho casa com algum padrão negado? Devolve o padrão (para a mensagem) ou null.
 * Puro: recebe o caminho já normalizado ou não, tanto faz.
 */
export function padraoNegado(caminho: string, negados: readonly string[]): string | null {
  const c = semBarraNoFim(caminho.split("\\").join("/").toLowerCase());
  const partes = c.split("/").filter(Boolean);
  for (const n of negados) {
    const pad = n.trim();
    if (!pad) continue;
    const pedacos = semBarraNoFim(pad).split("\\").join("/").toLowerCase().split("/").filter(Boolean);
    if (!pedacos.length) continue;
    if (pad.includes("/") || pad.includes("\\")) {
      // com barra: casa com qualquer trecho de N pedaços seguidos (N = pedaços do padrão), um
      // curinga por pedaço (o `*` não atravessa a barra), então a pasta de perfis do Chrome E
      // tudo que está abaixo dela são negados
      const qtd = pedacos.length;
      for (let i = qtd; i <= partes.length; i++) if (pedacos.every((pp, j) => casaCuringa(partes[i - qtd + j]!, pp))) return pad;
    } else if (partes.some((parte) => casaCuringa(parte, pedacos[0]!))) {
      return pad;
    }
  }
  return null;
}

/**
 * Pastas de dados da PRÓPRIA Órbita: nunca lidas nem escritas pelas mãos,
 * mesmo dentro de uma pasta liberada (o `.env` já é negado por padrão; isto
 * cobre a mídia do WhatsApp, os logs e as saídas do modo isolado).
 */
export function pastasDeDadosDaOrbita(): string[] {
  const out = [process.env.ORBITA_DATA_DIR ?? path.join(process.cwd(), "data")];
  const local = process.env.LOCALAPPDATA;
  if (local) out.push(W.join(local, "Orbita"));
  return out;
}

/** Padrões que valem SEMPRE, somados aos de `arquivos.negados` (a lista da tela só acrescenta). */
export const SEMPRE_NEGADOS = [".env", ".env.*", ".mcp.json", ".ssh", "*.pem", "*.key"] as const;
