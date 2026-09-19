// Mede reordenação (cross-encoder) NESTA máquina, que é o que decide se ela
// cabe no caminho do chat: latência por lote de candidatos e se a ordem melhora
// em perguntas de verdade do dono.
//
//   node bench/rerank.mjs --modelo=cross-encoder/mmarco-mMiniLMv2-L12-H384-v1 --arquivo=model_quint8_avx2
//   node bench/rerank.mjs --modelo=onnx-community/bge-reranker-v2-m3-ONNX --dtype=q8
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "1"]));
const require = createRequire(path.join(raiz, "packages", "core", "package.json"));
const { AutoTokenizer, AutoModelForSequenceClassification } = await import(pathToFileURL(require.resolve("@huggingface/transformers")).href);

const modelo = args.modelo ?? "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1";
const opcoes = { dtype: args.dtype ?? "fp32", ...(args.arquivo ? { model_file_name: args.arquivo } : {}) };

const t0 = Date.now();
const tokenizer = await AutoTokenizer.from_pretrained(modelo);
const model = await AutoModelForSequenceClassification.from_pretrained(modelo, opcoes);
console.log(`carregar: ${((Date.now() - t0) / 1000).toFixed(1)}s  (${modelo}, ${JSON.stringify(opcoes)})`);

const pergunta = "Quantos anos de garantia tem a impermeabilização do apartamento?";
const trechos = [
  "prazos de garantia 5 anos perda de garantia Situações não cobertas pela garantia Impermeabilizações",
  "Esquadrias de alumínio: as janelas e portas de correr foram montadas de modo a conferir estanqueidade.",
  "PIX QRS SHPP BRASIL08/03 -162,64 09/03/2026 PIX TRANSF ORBITMI09/03 15.000,00",
  "Imposto sobre a renda pessoa física, ano-calendário 2025, exercício 2026, declaração de ajuste anual.",
  "O condomínio é composto por unidades autônomas (os apartamentos), que são de propriedade exclusiva.",
  "A área privativa da unidade 71 é de 64,8240m², com 01 vaga indeterminada.",
];

async function pontuar(query, docs) {
  const entradas = tokenizer(new Array(docs.length).fill(query), { text_pair: docs, padding: true, truncation: true });
  const saida = await model(entradas);
  const logits = await saida.logits.tolist();
  return logits.map((l) => (Array.isArray(l) ? (l.length > 1 ? l[1] - l[0] : l[0]) : l));
}

// aquecimento (a primeira passada paga alocação de buffers)
await pontuar(pergunta, trechos.slice(0, 2));

for (const n of [5, 10, 20, 30]) {
  const docs = Array.from({ length: n }, (_, i) => trechos[i % trechos.length].slice(0, 1200));
  const marcas = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await pontuar(pergunta, docs);
    marcas.push(Date.now() - t);
  }
  marcas.sort((a, b) => a - b);
  console.log(`${String(n).padStart(2)} candidatos: mediana ${marcas[1]}ms  (${marcas.join("ms, ")}ms)`);
}

const notas = await pontuar(pergunta, trechos);
console.log("\nordem escolhida pelo reordenador:");
trechos
  .map((t, i) => ({ t, nota: notas[i] }))
  .sort((a, b) => b.nota - a.nota)
  .forEach((r, i) => console.log(` ${i + 1}. ${r.nota.toFixed(3)}  ${r.t.slice(0, 70)}`));
