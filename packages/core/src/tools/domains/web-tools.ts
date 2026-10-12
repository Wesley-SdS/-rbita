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
  inputSchema: z.object({ consulta: z.string().min(1).max(400) }),
  // na fila (Regra de Dois, `controle/contaminacao.ts`) o dono aprova a consulta INTEIRA, que é o que sai
  summarize: ({ consulta }) => `Pesquisar na internet: "${consulta}"`,
  run: async ({ consulta }) => searchWeb(consulta, 5),
};

export const ler_pagina: ToolDef<z.ZodObject<{ url: z.ZodString }>> = {
  name: "ler_pagina",
  domain: "web",
  description: "Lê o conteúdo de texto de uma página web a partir da URL.",
  risk: "leitura",
  keywords: ["ler", "página", "site", "link", "url", "artigo"],
  inputSchema: z.object({ url: z.string().url() }),
  // o endereço inteiro, com a consulta: é nela que um dado do dono sairia
  summarize: ({ url }) => `Abrir a página ${url.slice(0, 2000)}`,
  run: async ({ url }) => ({ conteudo: await fetchPage(url) }),
};

registerTools([pesquisar_web, ler_pagina]);
