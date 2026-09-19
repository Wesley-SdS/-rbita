// Medição do RAG com os documentos reais do dono (bench/data, fora do git).
//
// Mede ACERTO, não impressão: cada pergunta tem gabarito de documento + página
// (bench/perguntas.json), e o script compara as estratégias de busca sobre o
// MESMO acervo. Sem isso não há como afirmar que a busca híbrida melhorou.
//
//   node bench/medir.mjs indexar --tag=atual-nomic --chunk=atual --embed=nomic-embed-text
//   node bench/medir.mjs avaliar --tag=atual-nomic --embed=nomic-embed-text --modo=vetor
//
// A tabela `bench_chunk` vive no banco de dev e some com `node bench/medir.mjs limpar`.
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "../packages/db/node_modules/postgres/src/index.js";

const raiz = path.resolve(import.meta.dirname, "..");
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "1"]));
const comando = process.argv[2];
const DB = process.env.DATABASE_URL ?? "postgres://orbita:orbita@127.0.0.1:5433/orbita";
const sql = postgres(DB, { max: 4, onnotice: () => {} });

// ── embeddings ──────────────────────────────────────────────────────────────
// Modelos locais do Ollama e o de nuvem do Gemini, exatamente como a Órbita os
// chama (os modelos nomic exigem prefixo de tarefa).
const OLLAMA = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/v1\/?$/, "");
const PREFIXO = { query: "search_query: ", document: "search_document: " };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function embed(textos, { provider, model }, kind) {
  if (provider === "gemini") {
    const chave = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!chave) throw new Error("GEMINI_API_KEY ausente");
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
      body: JSON.stringify({ model: model ?? "gemini-embedding-2", input: textos, dimensions: 768 }),
    });
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
  const usaPrefixo = /nomic/.test(model);
  const r = await fetch(OLLAMA + "/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: usaPrefixo ? textos.map((t) => PREFIXO[kind] + t) : textos, keep_alive: "30m" }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.embeddings;
}

/**
 * O Ollama derruba o runner do nomic v1 em lote grande ("/tokenize: EOF") e o
 * Gemini gratuito devolve 429 por cota. Nos dois casos, insistir menor resolve:
 * divide o lote pela metade e tenta de novo, com espera.
 */
async function embedResiliente(textos, cfg, kind, tentativa = 0) {
  try {
    return await embed(textos, cfg, kind);
  } catch (e) {
    if (tentativa >= 4) throw e;
    await dormir(2000 * (tentativa + 1));
    if (textos.length === 1) return embedResiliente(textos, cfg, kind, tentativa + 1);
    const meio = Math.ceil(textos.length / 2);
    const a = await embedResiliente(textos.slice(0, meio), cfg, kind, tentativa + 1);
    const b = await embedResiliente(textos.slice(meio), cfg, kind, tentativa + 1);
    return [...a, ...b];
  }
}

const provedorDe = (nome) => (nome === "gemini" ? { provider: "gemini", model: "gemini-embedding-2" } : { provider: "ollama", model: nome });

// ── limpeza (a mesma da indexação) ──────────────────────────────────────────
// PDF de verdade traz byte nulo e metade de par substituto, que o Postgres
// recusa ("invalid byte sequence"). Escrito por código de caractere porque
// escape literal neste arquivo já virou byte de verdade uma vez.
const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
const NULO = String.fromCharCode(0);
function limpar(t) {
  const base = (t ?? "").split(CRLF).join(LF).split(NULO).join("");
  let saida = "";
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const p = base.charCodeAt(i + 1);
      if (p >= 0xdc00 && p <= 0xdfff) {
        saida += base[i] + base[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    saida += base[i];
  }
  return saida;
}

// ── chunking ────────────────────────────────────────────────────────────────

/** O algoritmo ANTIGO (corte por caractere, páginas coladas), para o "antes". */
function chunkAtual(text, size = 1000, overlap = 150) {
  const clean = text.split(CRLF).join(LF).replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [{ conteudo: clean, ini: 0, fim: clean.length }];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const cut = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (cut > size * 0.5) end = i + cut + 1;
    }
    chunks.push({ conteudo: clean.slice(i, end).trim(), ini: i, fim: end });
    i = end - overlap;
    if (end >= clean.length) break;
  }
  return chunks.filter((c) => c.conteudo);
}

/** Divide respeitando parágrafo, com sobreposição. */
function dividirRecursivo(texto, alvo, overlap) {
  const limpo = texto.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!limpo) return [];
  if (limpo.length <= alvo) return [limpo];
  const partes = [];
  let buffer = "";
  const empurrar = () => {
    if (buffer.trim()) partes.push(buffer.trim());
  };
  for (const bloco of limpo.split(/\n\n+/)) {
    const pedacos = bloco.length > alvo ? (bloco.match(new RegExp(`[\\s\\S]{1,${alvo}}(?=\\s|$)`, "g")) ?? [bloco]) : [bloco];
    for (const p of pedacos) {
      if ((buffer + p).length > alvo && buffer) {
        empurrar();
        buffer = buffer.slice(Math.max(0, buffer.length - overlap)) + "\n\n" + p;
      } else {
        buffer = buffer ? buffer + "\n\n" + p : p;
      }
    }
  }
  empurrar();
  return partes;
}

/** Corte NOVO: por página, com a página registrada e páginas curtas fundidas. */
function chunkNovo(paginas, alvo = 1600, overlap = 240) {
  const saida = [];
  let acumulado = "";
  let pagIni = 1;
  const despejar = (pagFim) => {
    for (const parte of dividirRecursivo(acumulado, alvo, overlap)) saida.push({ conteudo: parte, pagIni, pagFim });
    acumulado = "";
  };
  paginas.forEach((texto, idx) => {
    const num = idx + 1;
    const t = (texto ?? "").trim();
    if (!t) return;
    if (!acumulado) pagIni = num;
    acumulado = acumulado ? acumulado + "\n\n" + t : t;
    if (acumulado.length >= alvo * 0.6 || idx === paginas.length - 1) despejar(num);
  });
  if (acumulado) despejar(paginas.length);
  return saida;
}

// ── esquema ─────────────────────────────────────────────────────────────────
async function preparar() {
  await sql`CREATE EXTENSION IF NOT EXISTS unaccent`;
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  const [cfg] = await sql`SELECT 1 FROM pg_ts_config WHERE cfgname = 'portuguese_unaccent'`;
  if (!cfg) {
    await sql.unsafe(`CREATE TEXT SEARCH CONFIGURATION public.portuguese_unaccent ( COPY = pg_catalog.portuguese )`);
    await sql.unsafe(`ALTER TEXT SEARCH CONFIGURATION public.portuguese_unaccent ALTER MAPPING FOR hword, hword_part, word WITH public.unaccent, portuguese_stem`);
  }
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS bench_chunk (
      id bigserial PRIMARY KEY,
      tag text NOT NULL,
      doc text NOT NULL,
      pag_ini int NOT NULL,
      pag_fim int NOT NULL,
      conteudo text NOT NULL,
      embedding vector(768) NOT NULL,
      fts tsvector GENERATED ALWAYS AS (to_tsvector('public.portuguese_unaccent'::regconfig, coalesce(conteudo, ''))) STORED
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS bench_chunk_fts_idx ON bench_chunk USING GIN (fts)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS bench_chunk_tag_idx ON bench_chunk (tag)`);
}

async function carregarDocs() {
  // Teto de páginas por documento: os dois livros do acervo (246 e 201 páginas)
  // sozinhos valem 70% do corpus e levariam horas de embedding nesta CPU. Eles
  // entram truncados, como RUÍDO realista; nenhuma pergunta do gabarito aponta
  // para eles, então o teto não muda o que está sendo medido.
  const maxPaginas = Number(args.maxPaginas ?? 40);
  const bruto = JSON.parse(await readFile(path.join(raiz, "bench", "data", "extraido.json"), "utf-8"));
  return bruto
    .filter((d) => d.chars > 0)
    .map((d) => ({ ...d, paginas: (d.paginas.length > maxPaginas ? d.paginas.slice(0, maxPaginas) : d.paginas).map(limpar) }));
}

// ── indexar ─────────────────────────────────────────────────────────────────
async function indexar() {
  const tag = args.tag ?? "padrao";
  const emb = provedorDe(args.embed ?? "gemini");
  const docs = await carregarDocs();
  await preparar();
  await sql`DELETE FROM bench_chunk WHERE tag = ${tag}`;

  let total = 0;
  const t0 = Date.now();
  for (const doc of docs) {
    const pedacos =
      args.chunk === "atual"
        ? (() => {
            // como era antes: páginas coladas (mergePages: true) e corte por
            // caractere. A página é recuperada pelo offset só para o gabarito
            // poder ser comparado; o código antigo não a guardava.
            const limites = [];
            let pos = 0;
            const inteiro = doc.paginas
              .map((p, i) => {
                const t = p ?? "";
                limites.push({ pag: i + 1, ini: pos, fim: pos + t.length });
                pos += t.length + 1;
                return t;
              })
              .join("\n");
            return chunkAtual(inteiro, 1000, 150).map((c) => {
              const tocadas = limites.filter((l) => l.fim > c.ini && l.ini < c.fim).map((l) => l.pag);
              return { conteudo: c.conteudo, pagIni: tocadas[0] ?? 1, pagFim: tocadas.at(-1) ?? 1 };
            });
          })()
        : chunkNovo(doc.paginas, Number(args.alvo ?? 1600), Number(args.overlap ?? 240));

    for (let i = 0; i < pedacos.length; i += 16) {
      const lote = pedacos.slice(i, i + 16);
      const vetores = await embedResiliente(lote.map((c) => c.conteudo), emb, "document");
      await sql`INSERT INTO bench_chunk ${sql(
        lote.map((c, j) => ({ tag, doc: doc.nome, pag_ini: c.pagIni, pag_fim: c.pagFim, conteudo: c.conteudo, embedding: JSON.stringify(vetores[j]) })),
        "tag", "doc", "pag_ini", "pag_fim", "conteudo", "embedding",
      )}`;
    }
    total += pedacos.length;
    console.log(`  ${doc.nome}: ${pedacos.length} trechos`);
  }
  console.log(`[${tag}] ${total} trechos em ${((Date.now() - t0) / 1000).toFixed(0)}s (chunk=${args.chunk ?? "novo"}, embed=${emb.model})`);
}

// ── busca ───────────────────────────────────────────────────────────────────
const buscaVetor = (tag, vetor, k) => sql`
  SELECT id, doc, pag_ini, pag_fim, conteudo, 1 - (embedding <=> ${JSON.stringify(vetor)}::vector) AS sim
    FROM bench_chunk WHERE tag = ${tag}
   ORDER BY embedding <=> ${JSON.stringify(vetor)}::vector LIMIT ${k}`;

/**
 * Dois jeitos de virar a pergunta em consulta textual:
 *
 *  - `and` (`websearch_to_tsquery`): exige TODOS os termos no mesmo trecho. É o
 *    do exemplo oficial do pgvector, e é o que a medição mostrou ser péssimo
 *    para pergunta em linguagem natural ("qual o valor da conta de luz da Enel
 *    que vence em agosto?" não tem um trecho com todas as palavras).
 *  - `ou`: os mesmos lexemas normalizados, unidos por "|". Quem decide a ordem
 *    é o `ts_rank_cd`, que premia quantidade e proximidade dos termos achados.
 */
const buscaTexto = (tag, pergunta, k, modo = args.fts ?? "ou") =>
  modo === "and"
    ? sql`
      SELECT id, doc, pag_ini, pag_fim, conteudo, ts_rank_cd(fts, q) AS sim
        FROM bench_chunk, websearch_to_tsquery('public.portuguese_unaccent', ${pergunta}) q
       WHERE tag = ${tag} AND fts @@ q
       ORDER BY ts_rank_cd(fts, q) DESC LIMIT ${k}`
    : sql`
      SELECT id, doc, pag_ini, pag_fim, conteudo, ts_rank_cd(fts, q) AS sim
        FROM bench_chunk,
             (SELECT array_to_string(tsvector_to_array(to_tsvector('public.portuguese_unaccent', ${pergunta})), ' | ')::tsquery AS q) t
       WHERE tag = ${tag} AND t.q IS NOT NULL AND fts @@ t.q
       ORDER BY ts_rank_cd(fts, t.q) DESC LIMIT ${k}`;

/** Reciprocal Rank Fusion (Cormack 2009): 1/(k + posição), somado por lado. */
function fundirRRF(listas, pesos, k, limite) {
  const acumulado = new Map();
  listas.forEach((lista, idx) => {
    lista.forEach((linha, pos) => {
      const atual = acumulado.get(linha.id) ?? { linha, score: 0 };
      atual.score += (pesos[idx] ?? 1) / (k + pos + 1);
      acumulado.set(linha.id, atual);
    });
  });
  return [...acumulado.values()].sort((a, b) => b.score - a.score).slice(0, limite).map((e) => ({ ...e.linha, sim: e.score }));
}

/** Reordenador local (cross-encoder), carregado só quando pedido. */
async function carregarReordenador() {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const req = createRequire(path.join(raiz, "packages", "core", "package.json"));
  const { AutoTokenizer, AutoModelForSequenceClassification } = await import(pathToFileURL(req.resolve("@huggingface/transformers")).href);
  const modelo = args.reordenador ?? "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1";
  const opcoes = { dtype: args.dtype ?? "fp32", ...(args.arquivo ? { model_file_name: args.arquivo } : { model_file_name: "model_quint8_avx2" }) };
  const t0 = Date.now();
  const tokenizer = await AutoTokenizer.from_pretrained(modelo);
  const model = await AutoModelForSequenceClassification.from_pretrained(modelo, opcoes);
  console.log(`(reordenador ${modelo} carregado em ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return async (query, docs) => {
    const entradas = tokenizer(new Array(docs.length).fill(query), { text_pair: docs.map((d) => d.slice(0, 1200)), padding: true, truncation: true });
    const saida = await model(entradas);
    const logits = await saida.logits.tolist();
    return logits.map((l) => (Array.isArray(l) ? (l.length > 1 ? l[1] - l[0] : l[0]) : l));
  };
}

async function avaliar() {
  const tag = args.tag ?? "padrao";
  const modo = args.modo ?? "vetor";
  const emb = provedorDe(args.embed ?? "gemini");
  const k = Number(args.k ?? 5);
  const candidatos = Number(args.candidatos ?? 30);
  const rrfK = Number(args.rrfK ?? 60);
  const perguntas = JSON.parse(await readFile(path.join(raiz, "bench", "perguntas.json"), "utf-8"));
  const reordenar = args.rerank ? await carregarReordenador() : null;
  const tetoRerank = Number(args.rerankTop ?? 20);

  const acertou = (linha, gabarito) =>
    gabarito.some((g) => g.doc === linha.doc && g.paginas.some((p) => p >= linha.pag_ini && p <= linha.pag_fim));

  let hit = 0;
  let hit10 = 0;
  let somaRR = 0;
  let comResposta = 0;
  let semResposta = 0;
  const latencias = [];
  const erros = [];

  for (const q of perguntas) {
    const t0 = Date.now();
    let linhas;
    if (modo === "vetor") {
      const [v] = await embedResiliente([q.pergunta], emb, "query");
      linhas = await buscaVetor(tag, v, Math.max(k, 10));
    } else if (modo === "texto") {
      linhas = await buscaTexto(tag, q.pergunta, Math.max(k, 10));
    } else {
      const [v] = await embedResiliente([q.pergunta], emb, "query");
      const [sem, kw] = await Promise.all([buscaVetor(tag, v, candidatos), buscaTexto(tag, q.pergunta, candidatos)]);
      linhas = fundirRRF([sem, kw], [Number(args.pesoVetor ?? 1), Number(args.pesoTexto ?? 1)], rrfK, Math.max(k, 10));
    }
    if (reordenar && linhas.length > 1) {
      const entrada = [...linhas].slice(0, tetoRerank);
      const notas = await reordenar(q.pergunta, entrada.map((l) => l.conteudo));
      linhas = entrada.map((l, i) => ({ ...l, sim: notas[i] })).sort((a, b) => b.sim - a.sim);
    }
    latencias.push(Date.now() - t0);

    if (!q.gabarito.length) {
      semResposta++;
      continue;
    }
    comResposta++;
    const pos = linhas.findIndex((l) => acertou(l, q.gabarito));
    if (pos >= 0 && pos < k) hit++;
    if (pos >= 0 && pos < 10) {
      hit10++;
      somaRR += 1 / (pos + 1);
    }
    if (pos < 0 || pos >= k) erros.push(`${q.id} (${q.tipo}): ${pos < 0 ? "fora do top 10" : `posição ${pos + 1}`} — ${q.pergunta.slice(0, 60)}`);
  }

  const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  console.log(`\n=== ${tag} | modo=${modo} | k=${k} | embed=${emb.model}`);
  console.log(`Hit@${k}:  ${hit}/${comResposta} (${((hit / comResposta) * 100).toFixed(1)}%)`);
  console.log(`Hit@10: ${hit10}/${comResposta} (${((hit10 / comResposta) * 100).toFixed(1)}%)`);
  console.log(`MRR@10: ${(somaRR / comResposta).toFixed(3)}`);
  console.log(`Latencia: media ${Math.round(media(latencias))}ms, max ${Math.max(...latencias)}ms`);
  console.log(`Perguntas sem resposta no acervo: ${semResposta}`);
  if (erros.length) {
    console.log("Erros:");
    for (const e of erros) console.log("  - " + e);
  }
}

try {
  if (comando === "indexar") await indexar();
  else if (comando === "avaliar") await avaliar();
  else if (comando === "limpar") {
    await sql`DROP TABLE IF EXISTS bench_chunk`;
    console.log("bench_chunk removida");
  } else {
    console.log("uso: node bench/medir.mjs <indexar|avaliar|limpar> --tag=... --chunk=atual|novo --embed=gemini|<modelo ollama> --modo=vetor|texto|rrf");
  }
} finally {
  await sql.end();
}
