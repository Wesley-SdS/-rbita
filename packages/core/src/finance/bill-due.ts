import { and, eq, lte } from "drizzle-orm";
import { db } from "@orbita/db";
import { expense } from "@orbita/db/finance-schema";
import { events } from "../events/index";
import { settings } from "../settings";

/**
 * Aviso proativo de vencimento: a lógica de `contas_a_vencer` já existia como
 * ferramenta do chat, mas ninguém a chamava sem o dono perguntar. Agora o
 * processo persistente varre uma vez por dia (hora configurável) e emite
 * `finance.bill_due` por usuário com contas no horizonte; a regra padrão
 * transforma isso em notificação. Sem LLM no caminho: é dado, não opinião.
 */
export interface BillDueItem {
  descricao: string;
  valor: number;
  tipo: "a_pagar" | "a_receber";
  vencimento: string | null;
  vencida: boolean;
}

export async function billsDueFor(userId: string, dias: number): Promise<BillDueItem[]> {
  const limite = new Date(Date.now() + dias * 86_400_000);
  const rows = await db
    .select({ description: expense.description, amountCents: expense.amountCents, kind: expense.kind, dueDate: expense.dueDate })
    .from(expense)
    .where(and(eq(expense.userId, userId), eq(expense.paid, false), lte(expense.dueDate, limite)))
    .orderBy(expense.dueDate);
  const hoje = new Date();
  return rows
    .filter((r) => r.kind !== "expense")
    .map((r) => ({
      descricao: r.description,
      valor: r.amountCents / 100,
      tipo: r.kind === "payable" ? "a_pagar" : "a_receber",
      vencimento: r.dueDate?.toISOString().slice(0, 10) ?? null,
      vencida: r.dueDate ? r.dueDate < hoje : false,
    }));
}

/** Texto curto e legível para a notificação padrão. */
export function summarizeBills(items: BillDueItem[]): string {
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return items
    .map((i) => `${i.vencida ? "VENCIDA " : ""}${i.tipo === "a_pagar" ? "Pagar" : "Receber"}: ${i.descricao} ${brl(i.valor)}${i.vencimento ? " em " + i.vencimento.split("-").reverse().join("/") : ""}`)
    .join("\n");
}

/** Usuários com alguma conta em aberto (evita varrer quem não usa finanças). */
async function usersWithOpenBills(): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: expense.userId }).from(expense).where(eq(expense.paid, false));
  return rows.map((r) => r.userId);
}

/** Emite `finance.bill_due` para cada usuário com contas no horizonte. */
export async function emitBillDueEvents(): Promise<number> {
  const dias = await settings.get("finance.billDueDays");
  let emitted = 0;
  for (const userId of await usersWithOpenBills()) {
    const contas = await billsDueFor(userId, dias);
    if (!contas.length) continue;
    const total = contas.filter((c) => c.tipo === "a_pagar").reduce((s, c) => s + c.valor, 0);
    await events.emit("finance.bill_due", { dias, quantidade: contas.length, total, contas, resumo: summarizeBills(contas) }, { userId });
    emitted++;
  }
  return emitted;
}
