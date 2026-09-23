import { z } from "zod";
import { criarTarefa, editarTarefa, listarTarefas, removerTarefa } from "../../tarefas/store";
import { registerTools, type ToolDef } from "../registry";

/**
 * Domínio: tarefas (to-do).
 *
 * Elas passaram a guardar de onde vieram. O modelo pode criar uma tarefa
 * dizendo que ela nasceu de uma reunião, com o trecho que a originou e para
 * quem ficou: é o que responde "por que eu fiquei de fazer isso?" duas semanas
 * depois, quando o título sozinho não diz mais nada.
 */

const ORIGEM = z
  .object({
    tipo: z.enum(["reuniao", "documento", "chat"]),
    id: z.string().optional().describe("id do documento ou da reunião, quando houver"),
    titulo: z.string().optional().describe("título da reunião ou documento, copiado para o vínculo sobreviver"),
    trecho: z.string().optional().describe("o que foi dito que gerou a tarefa"),
  })
  .optional();

export const adicionar_tarefa: ToolDef<
  z.ZodObject<{
    texto: z.ZodString;
    vencimento: z.ZodOptional<z.ZodString>;
    anotacoes: z.ZodOptional<z.ZodString>;
    para_quem: z.ZodOptional<z.ZodString>;
    origem: typeof ORIGEM;
  }>
> = {
  name: "adicionar_tarefa",
  domain: "tarefas",
  description:
    "Adiciona uma tarefa (to-do) do usuário. Use `origem` quando a tarefa vier de uma reunião ou documento, com o trecho que a gerou.",
  risk: "escrita",
  keywords: ["tarefa", "to-do", "lembrete", "fazer", "adicionar", "pendência", "compromisso"],
  inputSchema: z.object({
    texto: z.string(),
    vencimento: z.string().optional().describe("data ISO ou AAAA-MM-DD"),
    anotacoes: z.string().optional(),
    para_quem: z.string().optional().describe("para quem o usuário ficou de fazer isso"),
    origem: ORIGEM,
  }),
  run: async ({ texto, vencimento, anotacoes, para_quem, origem }, { userId }) => {
    const row = await criarTarefa(userId, {
      texto,
      vencimento,
      anotacoes,
      paraQuem: para_quem,
      origem: origem ?? null,
    });
    return { adicionada: true, id: row?.id, texto };
  },
};

export const listar_tarefas: ToolDef<z.ZodObject<{ incluir_concluidas: z.ZodOptional<z.ZodBoolean> }>> = {
  name: "listar_tarefas",
  domain: "tarefas",
  description: "Lista as tarefas (to-dos) do usuário. Por padrão só as pendentes.",
  risk: "leitura",
  keywords: ["tarefas", "pendentes", "to-do", "lista", "o que falta", "compromissos"],
  inputSchema: z.object({ incluir_concluidas: z.boolean().optional() }),
  run: async ({ incluir_concluidas }, { userId }) => {
    const rows = await listarTarefas(userId);
    const visiveis = incluir_concluidas ? rows : rows.filter((t) => !t.done);
    return {
      tarefas: visiveis.map((t) => ({
        id: t.id,
        texto: t.text,
        concluida: t.done,
        vencimento: t.dueDate?.toISOString().slice(0, 10) ?? null,
        anotacoes: t.notes,
        para_quem: t.paraQuem,
        // o "por que" da tarefa: é o que o modelo precisa para responder
        // "isso veio da reunião com o fornecedor, você ficou de assinar"
        origem: t.origemTipo ? { tipo: t.origemTipo, titulo: t.origemTitulo, trecho: t.origemTrecho } : null,
      })),
    };
  },
};

export const editar_tarefa: ToolDef<
  z.ZodObject<{
    id: z.ZodString;
    texto: z.ZodOptional<z.ZodString>;
    vencimento: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    anotacoes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    para_quem: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  }>
> = {
  name: "editar_tarefa",
  domain: "tarefas",
  description:
    "Muda uma tarefa existente (texto, vencimento, anotações ou para quem). Só mande os campos que devem mudar; mande null para limpar um campo.",
  risk: "escrita",
  keywords: ["editar", "mudar", "alterar", "adiar", "remarcar", "corrigir", "tarefa"],
  inputSchema: z.object({
    id: z.string(),
    texto: z.string().optional(),
    vencimento: z.string().nullable().optional().describe("data ISO ou AAAA-MM-DD; null limpa"),
    anotacoes: z.string().nullable().optional(),
    para_quem: z.string().nullable().optional(),
  }),
  run: async ({ id, texto, vencimento, anotacoes, para_quem }, { userId }) => {
    const row = await editarTarefa(userId, id, { texto, vencimento, anotacoes, paraQuem: para_quem });
    if (!row) return { erro: "Não achei essa tarefa." };
    return { editada: true, texto: row.text, vencimento: row.dueDate?.toISOString().slice(0, 10) ?? null };
  },
};

export const concluir_tarefa: ToolDef<z.ZodObject<{ id: z.ZodString; reabrir: z.ZodOptional<z.ZodBoolean> }>> = {
  name: "concluir_tarefa",
  domain: "tarefas",
  description: "Marca uma tarefa como feita. Use `reabrir` para desmarcar.",
  risk: "escrita",
  keywords: ["concluir", "feito", "terminei", "fiz", "marcar", "reabrir", "tarefa"],
  inputSchema: z.object({ id: z.string(), reabrir: z.boolean().optional() }),
  run: async ({ id, reabrir }, { userId }) => {
    const row = await editarTarefa(userId, id, { concluida: !reabrir });
    if (!row) return { erro: "Não achei essa tarefa." };
    return { concluida: row.done, texto: row.text };
  },
};

export const remover_tarefa: ToolDef<z.ZodObject<{ id: z.ZodString }>> = {
  name: "remover_tarefa",
  domain: "tarefas",
  description: "Apaga uma tarefa de vez. Para só marcar como feita, use concluir_tarefa.",
  // apagar não dá para desfazer: vai para o gate humano em vez de sumir na hora
  risk: "perigoso",
  keywords: ["apagar", "remover", "excluir", "deletar", "tarefa"],
  inputSchema: z.object({ id: z.string() }),
  run: async ({ id }, { userId }) => {
    const apagou = await removerTarefa(userId, id);
    return apagou ? { removida: true } : { erro: "Não achei essa tarefa." };
  },
};

registerTools([adicionar_tarefa, listar_tarefas, editar_tarefa, concluir_tarefa, remover_tarefa]);
