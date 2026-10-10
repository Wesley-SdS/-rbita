import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { comigoDe } from "../../comigo/servico";

/**
 * Domínio: o que está com o dono na gestão e na central de chamados da
 * Adalink (`comigo/servico.ts`), mais os chamados atrasados da equipe. A
 * mesma visão do painel da tela inicial, para "o que está comigo?" pela voz.
 */

export const o_que_esta_comigo: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "o_que_esta_comigo",
  domain: "comigo",
  description:
    "Tudo que está com o dono na gestão da Adalink (atividades, com prazo) e na central de chamados (chamados atribuídos a ele), mais os chamados ATRASADOS da equipe: abertos sem tratativa e os que estão com um desenvolvedor mas passaram do prazo. Use para \"o que está comigo?\", \"tem chamado atrasado?\", \"o que colocaram para mim?\".",
  risk: "leitura",
  keywords: ["comigo", "atividade", "atividades", "chamado", "chamados", "ticket", "tickets", "atrasado", "atrasados", "gestão", "adalink", "prazo", "tratativa", "desenvolvedor"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const c = await comigoDe(userId);
    if (!c.partes.gestao && !c.partes.tickets) {
      return { erro: "Os servidores da gestão e dos chamados não estão ligados em Extensões (ou os nomes não batem com os de Ajustes, Comigo)." };
    }
    return {
      atividades_comigo: c.atividades,
      chamados_comigo: c.chamados.comigo,
      atrasados_sem_tratativa: c.chamados.semTratativa,
      atrasados_com_desenvolvedor: c.chamados.comDevAtrasados,
      nao_consegui_ler: c.falhas,
    };
  },
};

registerTools([o_que_esta_comigo]);
