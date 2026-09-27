import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "@orbita/db";
import { todo } from "@orbita/db/todo-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { notifyUser } from "../routines/run";

/**
 * Lembrete com hora (item 3 da proativa): "me lembra às 15h de ligar pro
 * contador" chega às 15h, pelo WhatsApp e pelo push. Antes a tarefa era criada
 * e nada chamava o dono na hora.
 *
 * O "já avisei" é marcado ANTES de avisar, numa troca condicional: dois
 * processos (o \`tsx watch\` deixa dois vivos por segundos) não avisam duas vezes.
 * Se o aviso falhar depois, perde-se aquele aviso; avisar em dobro seria pior.
 */

/** "15:00" ou, se atrasou muito (a Órbita estava desligada), "era para 27/09 15:00". PURA. */
export function textoDoLembrete(tarefa: { text: string; notes: string | null; lembrarEm: Date }, agora: Date, fuso: string): string {
  const atraso = agora.getTime() - tarefa.lembrarEm.getTime();
  let quando = "";
  if (atraso > 15 * 60_000) {
    try {
      quando = ` (era para ${tarefa.lembrarEm.toLocaleString("pt-BR", { timeZone: fuso || "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})`;
    } catch {
      quando = "";
    }
  }
  return tarefa.text + quando + (tarefa.notes ? `\n${tarefa.notes}` : "");
}

export async function dispararLembretes(agora = new Date()): Promise<number> {
  const devidos = await db
    .select()
    .from(todo)
    .where(and(lte(todo.lembrarEm, agora), isNull(todo.lembradoEm), eq(todo.done, false)))
    .limit(50);
  if (!devidos.length) return 0;
  const fuso = await settings.get("connectors.fusoHorario");
  let avisados = 0;
  for (const t of devidos) {
    const [meu] = await db.update(todo).set({ lembradoEm: agora }).where(and(eq(todo.id, t.id), isNull(todo.lembradoEm))).returning({ id: todo.id });
    if (!meu || !t.lembrarEm) continue; // outro processo pegou antes
    try {
      // o dono pediu AQUELA hora: fura o silêncio dos avisos
      await notifyUser(t.userId, "Lembrete", textoDoLembrete({ text: t.text, notes: t.notes, lembrarEm: t.lembrarEm }, agora, fuso), null, { destino: "/app", furaSilencio: true });
      avisados++;
    } catch (e) {
      log.warn("tarefas.lembrete_falhou", { erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return avisados;
}
