import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { todo } from "@orbita/db/todo-schema";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: tarefas (to-do). */

export const adicionar_tarefa: ToolDef<z.ZodObject<{ texto: z.ZodString; vencimento: z.ZodOptional<z.ZodString> }>> = {
  name: "adicionar_tarefa",
  domain: "tarefas",
  description: "Adiciona uma tarefa (to-do) do usuário, com vencimento opcional.",
  risk: "escrita",
  keywords: ["tarefa", "to-do", "lembrete", "fazer", "adicionar", "pendência"],
  inputSchema: z.object({ texto: z.string(), vencimento: z.string().optional().describe("data ISO") }),
  run: async ({ texto, vencimento }, { userId }) => {
    const due = vencimento ? new Date(vencimento) : null;
    await db.insert(todo).values({ userId, text: texto, dueDate: due && !isNaN(due.getTime()) ? due : null });
    return { adicionada: true, texto };
  },
};

export const listar_tarefas: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "listar_tarefas",
  domain: "tarefas",
  description: "Lista as tarefas (to-dos) pendentes do usuário.",
  risk: "leitura",
  keywords: ["tarefas", "pendentes", "to-do", "lista", "o que falta"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const rows = await db.select().from(todo).where(and(eq(todo.userId, userId), eq(todo.done, false)));
    return { tarefas: rows.map((t) => ({ texto: t.text, vencimento: t.dueDate?.toISOString().slice(0, 10) ?? null })) };
  },
};

registerTools([adicionar_tarefa, listar_tarefas]);
