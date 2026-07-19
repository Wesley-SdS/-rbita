import { embed, embedMany } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

function ollama() {
  return createOpenAICompatible({
    name: "ollama",
    baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
  });
}

export const EMBED_MODEL = "nomic-embed-text";
export const EMBED_DIMS = 768;

/**
 * O nomic-embed-text foi treinado com prefixos de tarefa e depende deles para o
 * recall assimétrico query↔documento. Sem os prefixos, a busca perde qualidade.
 * `query` = texto de busca; `document` = conteúdo indexado.
 */
export type EmbedKind = "query" | "document";
const PREFIX: Record<EmbedKind, string> = {
  query: "search_query: ",
  document: "search_document: ",
};

export async function embedText(value: string, kind: EmbedKind = "query"): Promise<number[]> {
  const { embedding } = await embed({ model: ollama().textEmbeddingModel(EMBED_MODEL), value: PREFIX[kind] + value });
  return embedding;
}

export async function embedTexts(values: string[], kind: EmbedKind = "document"): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: ollama().textEmbeddingModel(EMBED_MODEL),
    values: values.map((v) => PREFIX[kind] + v),
  });
  return embeddings;
}
