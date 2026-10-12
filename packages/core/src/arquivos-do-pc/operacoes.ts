import { createHash } from "node:crypto";
import { open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { settings } from "../settings";
import { casaCuringa, padraoNegado } from "../maos/pastas";
import { CaminhoRecusado, conferirCaminho, motivoDaRecusa, regrasDeArquivo, type RegrasDeArquivo } from "./guarda";

/**
 * LISTAR, LER, BUSCAR e ESCREVER arquivos do PC (PRD A4), sempre depois da guarda.
 *
 * Ler usa o EXTRATOR UNIVERSAL da frente C (`arquivos/extrair.ts`): Word,
 * planilha, PDF, ZIP, e-mail salvo, tudo vira texto do mesmo jeito que um
 * anexo. Executável nunca roda: o extrator só diz tipo, tamanho e hash.
 *
 * Escrever é sempre `efeito_externo` (a proposta mostra o DIFF), grava num
 * arquivo temporário ao lado e troca de nome no fim: cair no meio nunca deixa
 * meio arquivo. E confere que o arquivo não mudou desde a proposta.
 */

export interface ItemDaPasta {
  nome: string;
  tipo: "arquivo" | "pasta" | "link";
  tamanho: number | null;
  modificadoEm: string | null;
}

export async function listarPasta(caminho: string, max = 500): Promise<{ pasta: string; itens: ItemDaPasta[]; total: number; ocultos: number }> {
  const regras = await regrasDeArquivo();
  const c = await conferirCaminho(caminho, { regras });
  if (c.tipo !== "pasta") throw new CaminhoRecusado("Isso é um arquivo, não uma pasta: use ler.");
  const entradas = await readdir(c.real, { withFileTypes: true });
  const itens: ItemDaPasta[] = [];
  let ocultos = 0;
  for (const e of entradas) {
    const cheio = path.win32.join(c.real, e.name);
    // negado nem aparece: o nome de um arquivo de chave já diz demais
    if (padraoNegado(cheio, regras.negados) || motivoDaRecusa(cheio, regras)) {
      ocultos++;
      continue;
    }
    if (itens.length >= max) continue;
    let tamanho: number | null = null;
    let modificadoEm: string | null = null;
    try {
      const st = await stat(cheio);
      tamanho = e.isDirectory() ? null : st.size;
      modificadoEm = st.mtime.toISOString();
    } catch {
      /* link quebrado ou sem acesso: aparece sem os números */
    }
    itens.push({ nome: e.name, tipo: e.isSymbolicLink() ? "link" : e.isDirectory() ? "pasta" : "arquivo", tamanho, modificadoEm });
  }
  itens.sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome, "pt-BR") : a.tipo === "pasta" ? -1 : 1));
  return { pasta: c.real, itens, total: entradas.length - ocultos, ocultos };
}

export interface LeituraDoArquivo {
  caminho: string;
  tipo: string;
  familia: string;
  tamanho: number;
  texto: string;
  resumo: string;
  parte: number;
  partes: number;
  avisos: string[];
  sha256: string;
}

const cache = new Map<string, { em: number; leitura: Omit<LeituraDoArquivo, "parte" | "partes" | "texto"> & { textoInteiro: string } }>();

function chaveDoCache(real: string, tamanho: number, modificadoEm: string | null) {
  return `${real.toLowerCase()}|${tamanho}|${modificadoEm ?? ""}`;
}

/** Extrai (ou devolve do cache, se o arquivo não mudou) o texto inteiro. `sinal` corta no ponto seguro. */
export async function extrairArquivo(caminho: string, userId: string, sinal?: AbortSignal, progresso?: (feito: number, total: number | null, passo: string) => Promise<void>) {
  const regras = await regrasDeArquivo();
  const c = await conferirCaminho(caminho, { regras });
  if (c.tipo !== "arquivo") throw new CaminhoRecusado("Isso é uma pasta: use listar.");
  const maxMb = await settings.get("anexos.tamanhoMaxMb");
  if (c.tamanho > maxMb * 1024 * 1024) throw new CaminhoRecusado(`O arquivo tem ${Math.round(c.tamanho / 1024 / 1024)} MB, acima do teto de ${maxMb} MB (Ajustes, Anexos).`);
  const chave = chaveDoCache(c.real, c.tamanho, c.modificadoEm);
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < 30 * 60_000) return guardado.leitura;
  const bytes = await readFile(c.real);
  const { extrairIsolado } = await import("../arquivos/isolado");
  // arquivo do PC não tem remetente: nenhuma senha cadastrada é tentada, e a frase diz isso (I16)
  const ex = await extrairIsolado(bytes, { nome: path.win32.basename(c.real), userId, sinal, progresso, semRemetente: true });
  const leitura = {
    caminho: c.real,
    tipo: ex.tipo.ext,
    familia: ex.tipo.familia,
    tamanho: ex.tamanho,
    resumo: ex.resumo,
    avisos: ex.avisos,
    sha256: ex.sha256,
    textoInteiro: ex.lido ? ex.texto : "",
  };
  cache.set(chave, { em: Date.now(), leitura });
  if (cache.size > 50) for (const k of [...cache.keys()].slice(0, 20)) cache.delete(k);
  return leitura;
}

export async function lerArquivo(caminho: string, userId: string, parte = 1, sinal?: AbortSignal): Promise<LeituraDoArquivo> {
  const l = await extrairArquivo(caminho, userId, sinal);
  const max = await settings.get("anexos.caracteresMax");
  const { partesDoTexto } = await import("../arquivos/texto");
  const partes = l.textoInteiro ? partesDoTexto(l.textoInteiro, max) : [""];
  const i = Math.max(1, Math.min(parte, partes.length));
  const { textoInteiro: _t, ...resto } = l;
  return { ...resto, texto: partes[i - 1] ?? "", parte: i, partes: partes.length };
}

export interface Achado {
  caminho: string;
  linha?: number;
  trecho?: string;
}

const PULAR = new Set(["node_modules", ".git", ".next", ".turbo", ".venv", "__pycache__", "dist", "build", ".cache"]);
const TEXTO = /\.(txt|md|csv|tsv|json|jsonc|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|ps1|psm1|sh|bat|cmd|ini|cfg|conf|toml|ya?ml|log|sql|java|kt|cs|go|rs|rb|php|c|h|cpp|hpp|vue|svelte|env\.example)$/i;

/**
 * O nome casa com o que o modelo pediu: curinga (`*.pdf`, `nota?.txt`) ou um
 * trecho. Sem regex: com `*` virando `.*`, um pedido como `*a*a*a*…*b` travava
 * o processo inteiro num único nome comprido (exponencial no número de `*`).
 */
function casaNome(padrao: string): (nome: string) => boolean {
  const p = padrao.toLowerCase();
  return p.includes("*") || p.includes("?") ? (nome) => casaCuringa(nome, p) : (nome) => nome.includes(p);
}

/** Procura por NOME (glob ou trecho) e/ou por TEXTO dentro de arquivos de texto, com teto de arquivos olhados. */
export async function buscar(caminho: string, opts: { nome?: string | null; texto?: string | null; max?: number }): Promise<{ achados: Achado[]; olhados: number; cortou: boolean }> {
  const regras = await regrasDeArquivo();
  const raiz = await conferirCaminho(caminho, { regras });
  if (raiz.tipo !== "pasta") throw new CaminhoRecusado("A busca começa numa pasta.");
  const teto = await settings.get("arquivos.buscaMaxArquivos");
  const max = Math.min(opts.max ?? 50, 200);
  const casa = opts.nome ? casaNome(opts.nome.trim()) : null;
  const agulha = opts.texto?.trim().toLowerCase() || null;
  const achados: Achado[] = [];
  let olhados = 0;
  const fila = [raiz.real];
  while (fila.length && achados.length < max && olhados < teto) {
    const pasta = fila.shift()!;
    let itens;
    try {
      itens = await readdir(pasta, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of itens) {
      if (achados.length >= max || olhados >= teto) break;
      const cheio = path.win32.join(pasta, e.name);
      if (motivoDaRecusa(cheio, regras)) continue;
      if (e.isSymbolicLink()) continue; // link não é seguido na busca: poderia sair da pasta liberada
      if (e.isDirectory()) {
        if (!PULAR.has(e.name.toLowerCase())) fila.push(cheio);
        continue;
      }
      olhados++;
      const nomeOk = !casa || casa(e.name.toLowerCase());
      if (!nomeOk) continue;
      if (!agulha) {
        achados.push({ caminho: cheio });
        continue;
      }
      if (!TEXTO.test(e.name)) continue;
      try {
        const st = await stat(cheio);
        if (st.size > 2 * 1024 * 1024) continue;
        const linhas = (await readFile(cheio, "utf-8")).split(/\r?\n/);
        for (let i = 0; i < linhas.length && achados.length < max; i++) {
          if (linhas[i]!.toLowerCase().includes(agulha)) achados.push({ caminho: cheio, linha: i + 1, trecho: linhas[i]!.trim().slice(0, 200) });
        }
      } catch {
        /* sem acesso ou binário: segue */
      }
    }
  }
  return { achados, olhados, cortou: olhados >= teto || achados.length >= max };
}

// ── escrever ────────────────────────────────────────────────────────────────

/** Diff de linhas (LCS), no formato unificado, cortado. Puro. */
export function diffDeLinhas(antes: string, depois: string, maxLinhas = 120): string {
  const a = antes.split(/\r?\n/);
  const b = depois.split(/\r?\n/);
  if (a.length * b.length > 4_000_000) return `(arquivo grande: ${a.length} linhas viram ${b.length})`;
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      out.push(`+ ${b[j++]}`);
    } else {
      out.push(`- ${a[i++]}`);
    }
  }
  if (!out.length) return "(sem mudança)";
  return out.length > maxLinhas ? [...out.slice(0, maxLinhas), `... mais ${out.length - maxLinhas} linhas mudadas`].join("\n") : out.join("\n");
}

export const sha = (s: Buffer | string) => createHash("sha256").update(s).digest("hex");

export interface PlanoDeEscrita {
  real: string;
  existia: boolean;
  shaAnterior: string | null;
  diff: string;
}

export async function planejarEscrita(caminho: string, conteudo: string, modo: "criar" | "substituir" | "acrescentar"): Promise<PlanoDeEscrita> {
  const c = await conferirCaminho(caminho, { novo: true });
  if (c.tipo === "pasta") throw new CaminhoRecusado("Esse caminho é uma pasta.");
  if (modo === "criar" && c.existe) throw new CaminhoRecusado("Esse arquivo já existe. Para trocar o conteúdo, use modo substituir.");
  if (modo !== "criar" && !c.existe) throw new CaminhoRecusado("Esse arquivo não existe. Para criar, use modo criar.");
  let antes = "";
  let shaAnterior: string | null = null;
  if (c.existe) {
    if (c.tamanho > 5 * 1024 * 1024) throw new CaminhoRecusado("O arquivo tem mais de 5 MB: a Órbita só escreve arquivo de texto pequeno.");
    const buf = await readFile(c.real);
    shaAnterior = sha(buf);
    antes = buf.toString("utf-8");
  }
  const depois = modo === "acrescentar" ? antes + conteudo : conteudo;
  return { real: c.real, existia: c.existe, shaAnterior, diff: diffDeLinhas(antes, depois) };
}

/** Grava o que foi aprovado: confere que nada mudou desde a proposta e troca o arquivo de uma vez. */
export async function escreverAprovado(p: { caminho: string; conteudo: string; modo: "criar" | "substituir" | "acrescentar"; shaAnterior: string | null }, regras?: RegrasDeArquivo): Promise<{ caminho: string; bytes: number }> {
  const c = await conferirCaminho(p.caminho, { novo: true, regras });
  let atual = "";
  if (c.existe) {
    const buf = await readFile(c.real);
    if (p.shaAnterior && sha(buf) !== p.shaAnterior) throw new CaminhoRecusado("O arquivo mudou depois da proposta: veja de novo antes de escrever.");
    if (!p.shaAnterior) throw new CaminhoRecusado("O arquivo passou a existir depois da proposta: veja de novo antes de escrever.");
    atual = buf.toString("utf-8");
  } else if (p.shaAnterior) {
    throw new CaminhoRecusado("O arquivo sumiu depois da proposta.");
  }
  const final = p.modo === "acrescentar" ? atual + p.conteudo : p.conteudo;
  const tmp = `${c.real}.orbita-${process.pid}-${Date.now()}.tmp`;
  const h = await open(tmp, "wx");
  try {
    await h.writeFile(final, "utf-8");
    await h.sync();
  } finally {
    await h.close();
  }
  try {
    await rename(tmp, c.real);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
  return { caminho: c.real, bytes: Buffer.byteLength(final, "utf-8") };
}

