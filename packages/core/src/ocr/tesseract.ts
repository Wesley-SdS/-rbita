import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { log } from "../observability/logger";

/**
 * OCR local (tesseract.js, por+eng) com CONFIANÇA DE VERDADE.
 *
 * Duas diferenças em relação ao invólucro antigo:
 *
 * 1. O worker é REAPROVEITADO. Criar e destruir um worker por imagem jogava
 *    fora o carregamento do modelo a cada página (a própria doc do tesseract.js
 *    diz que isso é tempo desperdiçado quando as imagens vêm em sequência). Num
 *    PDF de 30 páginas isso era 30 carregamentos.
 *
 * 2. A confiança sai POR PALAVRA, não só a média que o Tesseract devolve. A
 *    média dele é simples: uma letra solta pesa igual a um CNPJ, então uma
 *    página de tabela com muito lixo curto pode "parecer" confiável. Com a
 *    confiança por palavra dá para ponderar por tamanho e olhar em separado os
 *    campos que doem quando saem errados (valor, data, CPF).
 */

export interface PalavraOcr {
  texto: string;
  confianca: number;
}

export interface ResultadoOcr {
  texto: string;
  /** 0 a 1, média das palavras ponderada pelo número de caracteres */
  confianca: number;
  /** fração das palavras abaixo de 50 de confiança (0 a 1) */
  fracaoRuim: number;
  palavras: PalavraOcr[];
}

function resolveWorkerPath(): string | undefined {
  const rel = "tesseract.js/src/worker-script/node/index.js";
  // require.resolve com o módulo em variável evita a reescrita estática do bundler
  try {
    const require = createRequire(import.meta.url);
    const p = require.resolve(rel);
    if (path.isAbsolute(p) && existsSync(p)) return p;
  } catch {
    /* tenta o fallback */
  }
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const cand = path.join(dir, "node_modules", rel);
    if (existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

type Worker = { recognize: (img: Buffer, opcoes: unknown, saida: unknown) => Promise<{ data: DadosPagina }>; terminate: () => Promise<unknown> };

interface DadosPagina {
  text: string;
  confidence: number;
  blocks?: { paragraphs?: { lines?: { words?: { text: string; confidence: number }[] }[] }[] }[] | null;
}

let workerPromise: Promise<Worker> | null = null;
let ocupado = false;
const fila: (() => void)[] = [];

async function obterWorker(idiomas: string): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const workerPath = resolveWorkerPath();
      // cachePath gravável: as traineddata (por/eng) baixam 1x da CDN e ficam
      // cacheadas (evita rebaixar a cada página; a 1ª vez precisa de internet).
      const cachePath = path.join(process.env.OCR_CACHE_DIR ?? tmpdir(), "orbita-tesseract");
      return (await createWorker(idiomas, 1, { ...(workerPath ? { workerPath } : {}), cachePath })) as unknown as Worker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Um worker por processo: o reconhecimento é serializado por esta fila. */
async function comWorker<T>(idiomas: string, fn: (w: Worker) => Promise<T>): Promise<T> {
  if (ocupado) await new Promise<void>((resolve) => fila.push(resolve));
  ocupado = true;
  try {
    const worker = await obterWorker(idiomas);
    return await fn(worker);
  } finally {
    ocupado = false;
    fila.shift()?.();
  }
}

/** Libera o worker (fim do processo, ou troca de idioma na configuração). */
export async function encerrarOcr(): Promise<void> {
  const atual = workerPromise;
  workerPromise = null;
  if (!atual) return;
  await atual.then((w) => w.terminate()).catch(() => {});
}

function extrairPalavras(data: DadosPagina): PalavraOcr[] {
  const palavras: PalavraOcr[] = [];
  for (const bloco of data.blocks ?? []) {
    for (const paragrafo of bloco.paragraphs ?? []) {
      for (const linha of paragrafo.lines ?? []) {
        for (const palavra of linha.words ?? []) {
          if (palavra.text?.trim()) palavras.push({ texto: palavra.text, confianca: palavra.confidence });
        }
      }
    }
  }
  return palavras;
}

/**
 * Confiança da página a partir das palavras, ponderada pelo tamanho.
 * Sem palavras (saída sem blocos), cai para a média do próprio Tesseract.
 * Puro: é a regra que decide se a página vai para o modelo de visão.
 */
export function confiancaDaPagina(palavras: PalavraOcr[], mediaTesseract: number): { confianca: number; fracaoRuim: number } {
  if (!palavras.length) return { confianca: Math.max(0, Math.min(1, mediaTesseract / 100)), fracaoRuim: mediaTesseract < 50 ? 1 : 0 };
  let peso = 0;
  let soma = 0;
  let ruins = 0;
  for (const p of palavras) {
    const chars = p.texto.trim().length;
    peso += chars;
    soma += (p.confianca / 100) * chars;
    if (p.confianca < 50) ruins++;
  }
  return { confianca: peso ? soma / peso : 0, fracaoRuim: ruins / palavras.length };
}

export async function ocrImagem(bytes: Buffer, opcoes: { idiomas?: string } = {}): Promise<ResultadoOcr> {
  const idiomas = opcoes.idiomas || "por+eng";
  const { data } = await comWorker(idiomas, (w) => w.recognize(bytes, {}, { blocks: true, text: true }));
  const palavras = extrairPalavras(data);
  const { confianca, fracaoRuim } = confiancaDaPagina(palavras, data.confidence ?? 0);
  log.info("ocr.pagina", { chars: data.text?.length ?? 0, confianca: Number(confianca.toFixed(3)), palavras: palavras.length });
  return { texto: data.text ?? "", confianca, fracaoRuim, palavras };
}

/** Compatibilidade com quem só quer o texto (cupom, imagem solta). */
export async function ocrImage(buf: Buffer): Promise<string> {
  return (await ocrImagem(buf)).texto;
}
