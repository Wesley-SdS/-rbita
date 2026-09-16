import { z } from "zod";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@orbita/db";
import { expense } from "@orbita/db/finance-schema";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: finanças pessoais (gastos, contas a pagar/receber). */

export const registrar_gasto: ToolDef<z.ZodObject<{ descricao: z.ZodString; valor: z.ZodNumber; categoria: z.ZodOptional<z.ZodString> }>> = {
  name: "registrar_gasto",
  domain: "financas",
  description: "Registra um gasto/despesa do usuário. Valor em reais (número).",
  risk: "escrita",
  keywords: ["gasto", "gastei", "despesa", "paguei", "comprei", "reais"],
  inputSchema: z.object({ descricao: z.string(), valor: z.number().describe("valor em reais"), categoria: z.string().optional() }),
  run: async ({ descricao, valor, categoria }, { userId }) => {
    await db.insert(expense).values({ userId, description: descricao, category: categoria ?? null, amountCents: Math.round(valor * 100) });
    return { registrado: true, valor, categoria: categoria ?? "outros" };
  },
};

export const resumo_financeiro: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "resumo_financeiro",
  domain: "financas",
  description: "Resumo dos gastos do usuário: total e por categoria.",
  risk: "leitura",
  keywords: ["gastos", "resumo", "categoria", "quanto gastei", "finanças"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const rows = await db.select({ category: expense.category, amountCents: expense.amountCents }).from(expense).where(eq(expense.userId, userId));
    const total = rows.reduce((s, r) => s + r.amountCents, 0) / 100;
    const porCategoria: Record<string, number> = {};
    for (const r of rows) {
      const k = r.category ?? "outros";
      porCategoria[k] = (porCategoria[k] ?? 0) + r.amountCents / 100;
    }
    return { total, moeda: "BRL", lancamentos: rows.length, porCategoria };
  },
};

const ContaInput = z.object({
  descricao: z.string(),
  valor: z.number().describe("valor em reais"),
  tipo: z.enum(["a_pagar", "a_receber"]),
  categoria: z.string().optional(),
  vencimento: z.string().optional().describe("data ISO YYYY-MM-DD"),
});
export const adicionar_conta: ToolDef<typeof ContaInput> = {
  name: "adicionar_conta",
  domain: "financas",
  description: "Cadastra uma conta a pagar ou a receber (com vencimento opcional). Para gastos já feitos use registrar_gasto.",
  risk: "escrita",
  keywords: ["conta", "boleto", "vencimento", "pagar", "receber", "fatura"],
  inputSchema: ContaInput,
  run: async ({ descricao, valor, tipo, categoria, vencimento }, { userId }) => {
    const due = vencimento ? new Date(vencimento) : null;
    await db.insert(expense).values({
      userId,
      description: descricao,
      category: categoria ?? null,
      amountCents: Math.round(valor * 100),
      kind: tipo === "a_pagar" ? "payable" : "receivable",
      dueDate: due && !isNaN(due.getTime()) ? due : null,
      paid: false,
    });
    return { cadastrado: true, tipo, valor, vencimento: vencimento ?? null };
  },
};

export const resumo_financeiro_completo: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "resumo_financeiro_completo",
  domain: "financas",
  description: "Resumo financeiro completo: total de gastos, contas a pagar e a receber em aberto, e saldo projetado.",
  risk: "leitura",
  keywords: ["saldo", "projetado", "a pagar", "a receber", "finanças", "resumo"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const rows = await db.select().from(expense).where(eq(expense.userId, userId));
    const sum = (k: string, onlyOpen = false) =>
      rows.filter((r) => r.kind === k && (!onlyOpen || !r.paid)).reduce((s, r) => s + r.amountCents, 0) / 100;
    const aPagar = sum("payable", true), aReceber = sum("receivable", true);
    return { gastos: sum("expense"), aPagar, aReceber, saldoProjetado: aReceber - aPagar, moeda: "BRL" };
  },
};

export const contas_a_vencer: ToolDef<z.ZodObject<{ dias: z.ZodDefault<z.ZodNumber> }>> = {
  name: "contas_a_vencer",
  domain: "financas",
  description: "Lista as contas a pagar e a receber em aberto que vencem nos próximos N dias (padrão 7). Use para alertar o usuário sobre vencimentos.",
  risk: "leitura",
  keywords: ["vencer", "vencimento", "contas", "próximos dias", "atrasada", "vencida"],
  inputSchema: z.object({ dias: z.number().int().min(0).max(90).default(7) }),
  run: async ({ dias }, { userId }) => {
    const limite = new Date(Date.now() + dias * 86400000);
    const rows = await db
      .select({ description: expense.description, amountCents: expense.amountCents, kind: expense.kind, dueDate: expense.dueDate })
      .from(expense)
      .where(and(eq(expense.userId, userId), eq(expense.paid, false), lte(expense.dueDate, limite)))
      .orderBy(expense.dueDate);
    const hoje = new Date();
    return {
      contas: rows
        .filter((r) => r.kind !== "expense")
        .map((r) => ({
          descricao: r.description,
          valor: r.amountCents / 100,
          tipo: r.kind === "payable" ? "a_pagar" : "a_receber",
          vencimento: r.dueDate?.toISOString().slice(0, 10) ?? null,
          vencida: r.dueDate ? r.dueDate < hoje : false,
        })),
    };
  },
};

registerTools([registrar_gasto, resumo_financeiro, adicionar_conta, resumo_financeiro_completo, contas_a_vencer]);
