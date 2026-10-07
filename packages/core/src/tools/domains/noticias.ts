import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { deixarDeSeguir, noticiasDe, seguirTema, temasDe, TemaInvalido } from "../../noticias/servico";
import { enqueueJob } from "../../jobs/queue";
import { acharPorNome } from "../../finance/nomes";

/**
 * Domínio: notícias sobre os temas que o dono segue (painel da tela inicial).
 * Seguir e deixar de seguir é escrita do próprio dono, sem efeito fora de
 * casa; a busca roda na fila. A consulta devolve as notícias também como
 * `resultados` (título, link, trecho): é esse formato que vira a pilha de
 * cards de fonte no chat e na voz (`chat/cartoes.ts`).
 */

const Consulta = z.object({
  tema: z.string().max(80).optional().describe("só as de um tema; sem tema, todos"),
  apenas_nao_lidas: z.boolean().optional(),
});
export const noticias_dos_meus_temas: ToolDef<typeof Consulta> = {
  name: "noticias_dos_meus_temas",
  domain: "noticias",
  description: "As notícias que a Órbita encontrou sobre os temas que o dono segue (busca diária na web). Use para \"o que saiu hoje sobre X\", \"me conta as notícias do meu tema\".",
  risk: "leitura",
  keywords: ["notícias", "noticias", "novidades", "saiu", "tema", "acompanhando", "hoje"],
  inputSchema: Consulta,
  run: async ({ tema, apenas_nao_lidas }, { userId }) => {
    const { temas } = await noticiasDe(userId, 8);
    if (!temas.length) return { erro: "Você ainda não segue nenhum tema. Diga, por exemplo, \"passa a acompanhar inteligência artificial na saúde\"." };
    let escolhidos = temas;
    if (tema) {
      const a = acharPorNome(temas, tema, (t) => t.tema);
      if (a.tipo === "nenhum") return { erro: `Você não segue o tema "${tema}".`, temas: temas.map((t) => t.tema) };
      escolhidos = a.tipo === "um" ? [a.item] : a.opcoes;
    }
    const porTema = escolhidos.map((t) => ({
      tema: t.tema,
      ultima_busca: t.ultimaBuscaEm?.toISOString() ?? null,
      noticias: t.noticias.filter((n) => !apenas_nao_lidas || !n.lida).map((n) => ({ titulo: n.titulo, site: n.site, resumo: n.resumo, link: n.url })),
    }));
    return {
      temas: porTema,
      resultados: porTema.flatMap((t) => t.noticias).map((n) => ({ titulo: n.titulo, url: n.link, trecho: n.resumo ?? "" })),
    };
  },
};

const Seguir = z.object({ tema: z.string().min(2).max(80).describe("o assunto, ex.: inteligência artificial na saúde") });
export const seguir_tema_de_noticias: ToolDef<typeof Seguir> = {
  name: "seguir_tema_de_noticias",
  domain: "noticias",
  description: "Passa a acompanhar um tema: todo dia a Órbita busca na web o que saiu de novo sobre ele e mostra no painel de notícias. A primeira busca sai na hora.",
  risk: "escrita",
  keywords: ["acompanhar", "seguir", "notícias", "tema", "me avisa", "novidades sobre"],
  inputSchema: Seguir,
  run: async ({ tema }, { userId }) => {
    try {
      const t = await seguirTema(userId, tema);
      await enqueueJob(userId, { kind: "noticias.buscar", payload: { temaId: t.id, tema: t.tema }, dedupKey: `noticias-tema:${t.id}` });
      return { mensagem: `Pronto, passo a acompanhar "${t.tema}". Já estou buscando as primeiras notícias.` };
    } catch (e) {
      if (e instanceof TemaInvalido) return { erro: e.message };
      throw e;
    }
  },
};

const Deixar = z.object({ tema: z.string().min(1).max(80) });
export const deixar_de_seguir_tema: ToolDef<typeof Deixar> = {
  name: "deixar_de_seguir_tema",
  domain: "noticias",
  description: "Para de acompanhar um tema de notícias (as notícias dele saem do painel).",
  risk: "escrita",
  keywords: ["parar", "deixar", "seguir", "acompanhar", "tema", "notícias"],
  inputSchema: Deixar,
  run: async ({ tema }, { userId }) => {
    const temas = await temasDe(userId);
    const a = acharPorNome(temas, tema, (t) => t.tema);
    if (a.tipo === "nenhum") return { erro: `Você não segue "${tema}".`, temas: temas.map((t) => t.tema) };
    if (a.tipo === "varios") return { erro: "Qual deles?", temas: a.opcoes.map((t) => t.tema) };
    await deixarDeSeguir(userId, a.item.id);
    return { mensagem: `Parei de acompanhar "${a.item.tema}".` };
  },
};

export const buscar_noticias_agora: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "buscar_noticias_agora",
  domain: "noticias",
  description: "Busca agora, sem esperar a busca diária, o que saiu de novo sobre os temas que o dono segue.",
  risk: "escrita",
  keywords: ["atualizar", "buscar", "agora", "notícias"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    if (!(await temasDe(userId)).length) return { erro: "Você ainda não segue nenhum tema." };
    await enqueueJob(userId, { kind: "noticias.buscar", payload: {}, dedupKey: `noticias-agora:${userId}` });
    return { mensagem: "Estou buscando as notícias dos seus temas. Em alguns instantes elas aparecem no painel." };
  },
};

registerTools([noticias_dos_meus_temas, seguir_tema_de_noticias, deixar_de_seguir_tema, buscar_noticias_agora]);
