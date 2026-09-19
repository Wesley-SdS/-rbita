// Extrai o texto PÁGINA A PÁGINA dos documentos de medição (bench/data, fora do
// git) para um JSON único. É o insumo do conjunto de perguntas e das medições:
// o gabarito aponta documento + página, então a extração já precisa ser por
// página (o RAG de hoje usa mergePages: true e perde essa informação).
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const raiz = path.resolve(import.meta.dirname, "..");
const dados = path.join(raiz, "bench", "data");
const require = createRequire(path.join(raiz, "packages", "core", "package.json"));
const { extractText, getDocumentProxy } = await import(pathToFileURL(require.resolve("unpdf")).href);

const saida = [];
for (const nome of (await readdir(dados)).filter((f) => f.toLowerCase().endsWith(".pdf"))) {
  const bytes = await readFile(path.join(dados, nome));
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const r = await extractText(pdf, { mergePages: false });
    const paginas = (Array.isArray(r.text) ? r.text : [r.text]).map((t) => t ?? "");
    const chars = paginas.reduce((s, p) => s + p.trim().length, 0);
    saida.push({ nome, totalPaginas: r.totalPages, paginas, chars, mediaPorPagina: Math.round(chars / r.totalPages) });
    console.log(`${nome}: ${r.totalPages} pág, ${chars} chars, média ${Math.round(chars / r.totalPages)}/pág`);
  } catch (e) {
    console.log(`${nome}: FALHOU (${e.message})`);
    saida.push({ nome, erro: String(e.message) });
  }
}

await mkdir(path.join(raiz, "bench", "data"), { recursive: true });
await writeFile(path.join(dados, "extraido.json"), JSON.stringify(saida, null, 1));
console.log(`\n${saida.length} documentos em bench/data/extraido.json`);
