import type { ToolSet } from "ai";
import { buscaNativaDoClaude } from "@orbita/llm";
import { settings } from "../settings";

/**
 * BUSCA NA WEB NATIVA quando quem responde é o Claude.
 *
 * A `pesquisar_web` raspa páginas de buscador (DuckDuckGo, Bing), que bloqueiam
 * e trazem só o trecho. A busca da própria Anthropic (`web_search`, executada
 * nos servidores dela) pesquisa, lê e CITA as fontes: medido em 27/09/2026 pela
 * assinatura, a cotação do dólar e a notícia do Opus 5.5 vieram certas, com 9
 * fontes, onde a raspagem tinha caído na Wikipédia e respondido "não achei".
 *
 * Ela só existe para modelo Claude (é ferramenta do provedor), então é trocada
 * POR MODELO, na hora de chamar: no failover para outro provedor, volta a
 * `pesquisar_web`. E só entra se a `pesquisar_web` foi escolhida para o turno
 * (ligada no catálogo e relevante ao pedido): desligar a web na tela desliga as
 * duas.
 */

export interface ConfigDaBusca {
  ativa: boolean;
  maxUsos: number;
}

export async function configDaBusca(): Promise<ConfigDaBusca> {
  const c = await settings.getMany(["web.buscaNativa", "web.buscaNativaMaxUsos"]).catch(() => null);
  return { ativa: c?.["web.buscaNativa"] ?? true, maxUsos: c?.["web.buscaNativaMaxUsos"] ?? 3 };
}

/** O ToolSet para ESTE modelo. PURA sobre o que recebe (a ferramenta do provedor é só um objeto). */
export function comBuscaNativa(tools: ToolSet | undefined, modelKey: string, cfg: ConfigDaBusca): ToolSet | undefined {
  if (!tools || !cfg.ativa || !modelKey.startsWith("claude/") || !("pesquisar_web" in tools)) return tools;
  const { pesquisar_web: _raspagem, ...resto } = tools;
  return { ...resto, web_search: buscaNativaDoClaude(cfg.maxUsos) as ToolSet[string] };
}
