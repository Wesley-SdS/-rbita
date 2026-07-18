import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { expense } from "@/lib/db/finance-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  description: z.string().min(1).max(200),
  amount: z.number().positive(), // em reais
  kind: z.enum(["expense", "payable", "receivable"]).default("expense"),
  category: z.string().max(60).optional(),
  dueDate: z.string().datetime().optional(),
});

/** Dashboard financeiro: gastos + contas a pagar + a receber + totais. */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const rows = await db.select().from(expense).where(eq(expense.userId, session.user.id)).orderBy(desc(expense.createdAt));

  const money = (c: number) => c / 100;
  const gastos = rows.filter((r) => r.kind === "expense");
  const aPagar = rows.filter((r) => r.kind === "payable");
  const aReceber = rows.filter((r) => r.kind === "receivable");
  const sum = (rs: typeof rows) => rs.reduce((s, r) => s + r.amountCents, 0);

  return Response.json({
    entries: rows.map((r) => ({ ...r, amount: money(r.amountCents), dueDate: r.dueDate?.toISOString() ?? null })),
    totals: {
      gastos: money(sum(gastos)),
      aPagar: money(sum(aPagar.filter((r) => !r.paid))),
      aReceber: money(sum(aReceber.filter((r) => !r.paid))),
      saldoProjetado: money(sum(aReceber.filter((r) => !r.paid)) - sum(aPagar.filter((r) => !r.paid))),
    },
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const d = parsed.data;
  const [row] = await db
    .insert(expense)
    .values({
      userId: session.user.id,
      description: d.description,
      category: d.category ?? null,
      amountCents: Math.round(d.amount * 100),
      kind: d.kind,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
      paid: d.kind === "expense",
    })
    .returning({ id: expense.id });
  return Response.json({ id: row?.id });
}

/** Marca uma conta como paga/recebida. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const { id, paid } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.update(expense).set({ paid: paid !== false }).where(and(eq(expense.id, id), eq(expense.userId, session.user.id)));
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  await db.delete(expense).where(and(eq(expense.id, id), eq(expense.userId, session.user.id)));
  return Response.json({ ok: true });
}
