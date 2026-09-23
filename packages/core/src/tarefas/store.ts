import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { todo, type Todo } from "@orbita/db/todo-schema";
import { camposDaEdicao, dataDeVencimento, edicaoVazia, type EdicaoDeTarefa } from "./campos";

/**
 * As tarefas do dono.
 *
 * Toda consulta filtra por `userId` (§6), inclusive as de escrita: sem isso um
 * id adivinhado editaria a tarefa de outra pessoa da casa.
 */

/** De onde a tarefa veio. O título fica COPIADO para o vínculo sobreviver ao apagar da origem. */
export interface OrigemDaTarefa {
  tipo: "reuniao" | "documento" | "chat";
  id?: string | null;
  titulo?: string | null;
  /** o trecho que gerou a tarefa: é o "por que eu fiquei de fazer isso" */
  trecho?: string | null;
}

export interface NovaTarefa {
  texto: string;
  vencimento?: string | null;
  imagemUrl?: string | null;
  anotacoes?: string | null;
  paraQuem?: string | null;
  origem?: OrigemDaTarefa | null;
}

export async function listarTarefas(userId: string): Promise<Todo[]> {
  // pendente primeiro, e dentro de cada grupo a mais recente no topo: uma lista
  // que cresce pelo fim empurra o que importa para fora da tela
  return db
    .select()
    .from(todo)
    .where(eq(todo.userId, userId))
    .orderBy(asc(todo.done), desc(todo.createdAt));
}

export async function criarTarefa(userId: string, nova: NovaTarefa): Promise<Todo | null> {
  const [row] = await db
    .insert(todo)
    .values({
      userId,
      text: nova.texto.trim(),
      dueDate: dataDeVencimento(nova.vencimento),
      imageUrl: nova.imagemUrl ?? null,
      notes: nova.anotacoes?.trim() || null,
      paraQuem: nova.paraQuem?.trim() || null,
      origemTipo: nova.origem?.tipo ?? null,
      origemId: nova.origem?.id ?? null,
      origemTitulo: nova.origem?.titulo ?? null,
      origemTrecho: nova.origem?.trecho ?? null,
    })
    .returning();
  return row ?? null;
}

/** Devolve a tarefa já atualizada, ou null quando o id não é do dono. */
export async function editarTarefa(userId: string, id: string, edicao: EdicaoDeTarefa): Promise<Todo | null> {
  const campos = camposDaEdicao(edicao);
  if (edicaoVazia(campos)) {
    const [atual] = await db.select().from(todo).where(and(eq(todo.id, id), eq(todo.userId, userId)));
    return atual ?? null;
  }
  const [row] = await db
    .update(todo)
    .set(campos)
    .where(and(eq(todo.id, id), eq(todo.userId, userId)))
    .returning();
  return row ?? null;
}

export async function removerTarefa(userId: string, id: string): Promise<boolean> {
  const apagadas = await db
    .delete(todo)
    .where(and(eq(todo.id, id), eq(todo.userId, userId)))
    .returning({ id: todo.id });
  return apagadas.length > 0;
}

/** As tarefas que nasceram de uma reunião (ou documento). É o caminho de volta da tela da reunião. */
export async function tarefasDaOrigem(userId: string, origemId: string): Promise<Todo[]> {
  return db
    .select()
    .from(todo)
    .where(and(eq(todo.userId, userId), eq(todo.origemId, origemId)))
    .orderBy(asc(todo.done), desc(todo.createdAt));
}
