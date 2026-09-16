import { z } from "zod";
import { getAccessToken } from "../../connectors/store";
import { searchNotion, readNotionPage } from "../../connectors/notion";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: Notion (leitura). Só entra com o conector ligado. */

export const buscar_notion: ToolDef<z.ZodObject<{ consulta: z.ZodString; quantidade: z.ZodDefault<z.ZodNumber> }>> = {
  name: "buscar_notion",
  domain: "notion",
  description: "Busca páginas no Notion do usuário por texto.",
  risk: "leitura",
  keywords: ["notion", "página", "buscar", "nota", "wiki"],
  requires: { connector: "notion" },
  inputSchema: z.object({ consulta: z.string(), quantidade: z.number().int().min(1).max(10).default(5) }),
  run: async ({ consulta, quantidade }, { userId }) => {
    const t = await getAccessToken("notion", userId);
    if (!t) return { erro: "Notion não conectado" };
    return { paginas: await searchNotion(t, consulta, quantidade) };
  },
};

export const ler_pagina_notion: ToolDef<z.ZodObject<{ pagina_id: z.ZodString }>> = {
  name: "ler_pagina_notion",
  domain: "notion",
  description: "Lê o conteúdo de texto de uma página do Notion pelo id (obtido em buscar_notion).",
  risk: "leitura",
  keywords: ["notion", "página", "ler", "conteúdo"],
  requires: { connector: "notion" },
  inputSchema: z.object({ pagina_id: z.string() }),
  run: async ({ pagina_id }, { userId }) => {
    const t = await getAccessToken("notion", userId);
    if (!t) return { erro: "Notion não conectado" };
    return { conteudo: await readNotionPage(t, pagina_id) };
  },
};

registerTools([buscar_notion, ler_pagina_notion]);
