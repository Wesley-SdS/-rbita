import { settings } from "../settings";
import { log } from "../observability/logger";
import type { RagHit } from "./retrieve";

/**
 * REORDENAÇÃO DOS CANDIDATOS (R2).
 *
 * A busca (vetor + palavra, fundidas por RRF) é boa para NÃO PERDER o trecho
 * certo entre dezenas de candidatos; ela é ruim para dizer qual dos trinta é o
 * melhor. Quem resolve isso é um modelo que lê a pergunta e o trecho JUNTOS
 * (cross-encoder), em vez de comparar dois vetores calculados em separado.
 *
 * No Quati (avaliação de recuperação em pt-BR), o reordenador foi o maior salto
 * isolado: nDCG@10 de 0,4467 só com busca textual para 0,7109 com reordenação.
 *
 * Três caminhos, escolhidos pela tela (`rag.rerank`):
 *   - `nenhum`: a ordem do RRF vale. Zero latência.
 *   - `local`: cross-encoder multilíngue em ONNX, dentro de casa, na CPU.
 *   - `cohere`: API de reordenação (precisa de COHERE_API_KEY), mais precisa e
 *     mais rápida, mas o trecho do documento sai de casa.
 *
 * Fail-soft SEMPRE: reordenação que falha ou demora devolve a ordem original.
 * Nunca derrubar um turno de chat por causa de um refinamento.
 */

export type RerankProvider = "nenhum" | "local" | "cohere";

/** Modelo local carregado uma vez por processo (o carregamento custa segundos). */
let localCarregado: Promise<{ tokenizer: unknown; model: unknown }> | null = null;

interface TransformersModulo {
  AutoTokenizer: { from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<any> };
  AutoModelForSequenceClassification: { from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<any> };
  env: { allowLocalModels: boolean; cacheDir?: string };
}

async function carregarLocal(modelo: string, arquivo: string) {
  if (!localCarregado) {
    localCarregado = (async () => {
      const mod = (await import("@huggingface/transformers")) as unknown as TransformersModulo;
      if (process.env.ORBITA_MODELS_DIR) mod.env.cacheDir = process.env.ORBITA_MODELS_DIR;
      const [tokenizer, model] = await Promise.all([
        mod.AutoTokenizer.from_pretrained(modelo),
        // `model_file_name` aponta para o arquivo quantizado (int8) do repo, que
        // não segue a convenção de nome que a biblioteca espera. Sem isso, ela
        // baixaria os 471MB do fp32 e gastaria o dobro de tempo por par.
        mod.AutoModelForSequenceClassification.from_pretrained(modelo, { model_file_name: arquivo, dtype: "fp32" }),
      ]);
      return { tokenizer, model };
    })().catch((e) => {
      localCarregado = null;
      throw e;
    });
  }
  return localCarregado;
}

/** Pontua cada par (pergunta, trecho) com o cross-encoder local. */
async function pontuarLocal(query: string, textos: string[], modelo: string, arquivo: string, maxChars: number): Promise<number[]> {
  const { tokenizer, model } = (await carregarLocal(modelo, arquivo)) as { tokenizer: any; model: any };
  const entradas = tokenizer(new Array(textos.length).fill(query), {
    text_pair: textos.map((t) => t.slice(0, maxChars)),
    padding: true,
    truncation: true,
  });
  const saida = await model(entradas);
  const logits = await saida.logits.tolist();
  // cross-encoder de relevância devolve um logit por par (quanto maior, melhor)
  return logits.map((l: number[] | number) => (Array.isArray(l) ? (l.length > 1 ? l[1]! - l[0]! : l[0]!) : l));
}

/** Pontua pela API da Cohere (rerank multilíngue). */
async function pontuarCohere(query: string, textos: string[], modelo: string, topN: number): Promise<number[]> {
  const chave = process.env.COHERE_API_KEY;
  if (!chave) throw new Error("COHERE_API_KEY não configurada");
  const r = await fetch("https://api.cohere.com/v2/rerank", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify({ model: modelo, query, documents: textos, top_n: Math.min(topN, textos.length) }),
  });
  if (!r.ok) throw new Error(`cohere ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { results: { index: number; relevance_score: number }[] };
  const notas = new Array<number>(textos.length).fill(-Infinity);
  for (const item of j.results) notas[item.index] = item.relevance_score;
  return notas;
}

/**
 * Reordena os candidatos e devolve os `k` melhores. Se a reordenação estiver
 * desligada, ou falhar, a ordem que chegou (do RRF) é respeitada.
 */
export async function rerank(query: string, candidatos: RagHit[], k: number): Promise<RagHit[]> {
  if (candidatos.length <= 1) return candidatos.slice(0, k);
  const cfg = await settings.getMany(["rag.rerank", "rag.rerankModel", "rag.rerankFile", "rag.rerankMaxChars", "rag.rerankTimeoutMs", "rag.rerankCandidates"]);
  const provider = cfg["rag.rerank"] as RerankProvider;
  if (provider === "nenhum") return candidatos.slice(0, k);

  const entrada = candidatos.slice(0, Math.max(k, cfg["rag.rerankCandidates"]));
  const t0 = Date.now();
  try {
    const notas = await Promise.race([
      provider === "cohere"
        ? pontuarCohere(query, entrada.map((c) => c.content), cfg["rag.rerankModel"] || "rerank-v3.5", entrada.length)
        : pontuarLocal(query, entrada.map((c) => c.content), cfg["rag.rerankModel"] || "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1", cfg["rag.rerankFile"], cfg["rag.rerankMaxChars"]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), cfg["rag.rerankTimeoutMs"])),
    ]);
    const ordenado = entrada
      .map((c, i) => ({ c, nota: notas[i] ?? -Infinity }))
      .sort((a, b) => b.nota - a.nota)
      .slice(0, k)
      .map(({ c, nota }) => ({ ...c, sim: nota }));
    log.info("rag.rerank", { provider, candidatos: entrada.length, ms: Date.now() - t0 });
    return ordenado;
  } catch (e) {
    // degradar é o comportamento certo: a busca já trouxe candidatos bons
    log.error("rag.rerank", { provider, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
    return candidatos.slice(0, k);
  }
}
