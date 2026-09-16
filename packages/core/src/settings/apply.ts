import { configureEmbeddings, configureFailover } from "@orbita/llm";
import { settings } from "./index";

/**
 * Leva a config até o packages/llm, que não pode depender do core (o core
 * depende dele). Barato: uma leitura em cache por chamada; chamar no início
 * de cada turno do chat e de cada execução de rotina garante "mudou na tela,
 * vale agora" sem restart.
 */
export async function applyLlmSettings(): Promise<void> {
  const cfg = await settings.getMany(["resilience.cbThreshold", "resilience.cbCooldownMs"]);
  configureFailover({ threshold: cfg["resilience.cbThreshold"], cooldownMs: cfg["resilience.cbCooldownMs"] });
}

// A preferência de embedding é lida NO embed (getter), para valer em qualquer
// rota que embede (reindexar, ingest, memória, skills), não só no chat.
configureEmbeddings({ provider: () => settings.get("embeddings.provider") });
