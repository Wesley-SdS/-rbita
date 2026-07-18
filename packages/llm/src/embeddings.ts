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

export async function embedText(value: string): Promise<number[]> {
  const { embedding } = await embed({ model: ollama().textEmbeddingModel(EMBED_MODEL), value });
  return embedding;
}

export async function embedTexts(values: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: ollama().textEmbeddingModel(EMBED_MODEL), values });
  return embeddings;
}
