import { and, eq, lte } from "drizzle-orm";
import { db } from "@orbita/db";
import { finCompromisso } from "@orbita/db/finance-schema";
import { somarDias } from "./calendario";
import { hojeDoServidor } from "./store";
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
  const hoje = hojeDoServidor();
  // o vencido entra junto (não tem limite inferior): conta atrasada é a que mais importa avisar
  const rows = await db
    .select({ descricao: finCompromisso.descricao, valor: finCompromisso.valor, direcao: finCompromisso.direcao, vencimento: finCompromisso.vencimento })
    .from(finCompromisso)
    .where(and(eq(finCompromisso.userId, userId), eq(finCompromisso.status, "aberto"), lte(finCompromisso.vencimento, somarDias(hoje, dias))))
    .orderBy(finCompromisso.vencimento);
  return rows.map((r) => ({
    descricao: r.descricao,
    valor: r.valor / 100,
    tipo: r.direcao === "pagar" ? "a_pagar" : "a_receber",
    vencimento: r.vencimento,
    vencida: r.vencimento < hoje,
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
  const rows = await db.selectDistinct({ userId: finCompromisso.userId }).from(finCompromisso).where(eq(finCompromisso.status, "aberto"));
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
