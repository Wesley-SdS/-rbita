import { z } from "zod";
import { searchWeb, fetchPage } from "../web";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: web (busca e leitura de página, com defesa SSRF em fetchPage). */

export const pesquisar_web: ToolDef<z.ZodObject<{ consulta: z.ZodString }>> = {
  name: "pesquisar_web",
  domain: "web",
  description: "Pesquisa na internet e retorna resultados (título, url, trecho). Use para informação atual.",
  risk: "leitura",
  keywords: ["pesquisar", "buscar", "internet", "notícia", "cotação", "atual", "quem é", "o que é", "preço"],
  inputSchema: z.object({ consulta: z.string() }),
  run: async ({ consulta }) => searchWeb(consulta, 5),
};

export const ler_pagina: ToolDef<z.ZodObject<{ url: z.ZodString }>> = {
  name: "ler_pagina",
  domain: "web",
  description: "Lê o conteúdo de texto de uma página web a partir da URL.",
  risk: "leitura",
  keywords: ["ler", "página", "site", "link", "url", "artigo"],
  inputSchema: z.object({ url: z.string().url() }),
  run: async ({ url }) => ({ conteudo: await fetchPage(url) }),
};

registerTools([pesquisar_web, ler_pagina]);
