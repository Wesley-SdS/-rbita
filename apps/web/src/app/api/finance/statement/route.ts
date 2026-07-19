import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel, DEFAULT_MODEL_KEY } from "@orbita/llm";
import { db } from "@/lib/db";
import { expense } from "@/lib/db/finance-schema";
import { getSession } from "@/lib/session";
import { log } from "@/lib/observability/logger";
import { parseYmd } from "@/lib/finance/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ItemSchema = z.object({
  descricao: z.string(),
  valor: z.number().describe("valor em reais, positivo"),
  tipo: z.enum(["expense", "receivable"]).describe("débito/compra=expense; crédito/entrada=receivable"),
  data: z.string().nullable().describe("YYYY-MM-DD ou null"),
  categoria: z.string(),
});

const INSTRUCAO =
  "Você recebe um trecho de EXTRATO bancário/cartão. Extraia TODOS os lançamentos deste trecho. " +
  "Débitos/compras = expense; créditos/entradas = receivable. Ignore saldos e cabeçalhos.\n\nTrecho:\n\n";

/** Divide o texto em blocos que cabem no contexto, cortando em quebras de linha. */
function splitBlocks(text: string, size = 6000): string[] {
  const blocks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > i + size / 2) end = nl;
    }
    blocks.push(text.slice(i, end));
    i = end;
  }
  return blocks;
}

/** Importa um extrato PDF → texto → LLM lista os lançamentos (por blocos) → cadastra. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Arquivo ausente" }, { status: 400 });

  // 1) texto do PDF (unpdf) — ou texto puro
  let text = "";
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const r = await extractText(pdf, { mergePages: true });
      text = Array.isArray(r.text) ? r.text.join("\n") : r.text;
    } else {
      text = buf.toString("utf-8");
    }
  } catch (e) {
    log.error("finance.statement.parse", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Falha ao ler o PDF" }, { status: 502 });
  }
  if (!text.trim()) return Response.json({ error: "PDF sem texto extraível (é uma imagem? use o comprovante por foto)" }, { status: 422 });

  // 2) LLM extrai por blocos (extratos longos não são truncados) — structured output
  const model = resolveModel(DEFAULT_MODEL_KEY);
  const blocks = splitBlocks(text, 6000).slice(0, 12); // teto de segurança
  const all: z.infer<typeof ItemSchema>[] = [];
  for (const block of blocks) {
    try {
      const { object } = await generateObject({ model, output: "array", schema: ItemSchema, prompt: INSTRUCAO + block });
      all.push(...object);
    } catch (e) {
      log.error("finance.statement.llm", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (all.length === 0) return Response.json({ error: "Não consegui extrair lançamentos do extrato" }, { status: 422 });

  // 3) dedup (data+valor+descrição) e cadastro em lote
  const seen = new Set<string>();
  const rows = all
    .map((o) => {
      const valor = Number(o.valor) || 0;
      if (valor <= 0) return null;
      const key = `${o.data ?? ""}|${valor}|${(o.descricao ?? "").toLowerCase().slice(0, 40)}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        userId: session.user.id,
        description: o.descricao || "Lançamento",
        category: o.categoria || null,
        amountCents: Math.round(valor * 100),
        kind: o.tipo === "receivable" ? ("receivable" as const) : ("expense" as const),
        dueDate: parseYmd(o.data),
        paid: o.tipo !== "receivable",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length) await db.insert(expense).values(rows);
  log.info("finance.statement", { userId: session.user.id, importados: rows.length });
  return Response.json({ importados: rows.length, lancamentos: rows.map((r) => ({ descricao: r.description, valor: r.amountCents / 100, tipo: r.kind })) });
}
