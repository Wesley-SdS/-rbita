import { generateText } from "ai";
import { resolveModel, DEFAULT_MODEL_KEY } from "@orbita/llm";
import { db } from "@/lib/db";
import { expense } from "@/lib/db/finance-schema";
import { getSession } from "@/lib/session";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROMPT =
  "Você recebe o texto de um EXTRATO bancário/cartão. Extraia TODOS os lançamentos e responda APENAS um array JSON, " +
  "sem texto extra, no formato: " +
  '[{"descricao": string, "valor": number (reais, positivo), "tipo": "expense"|"receivable", "data": "YYYY-MM-DD"|null, "categoria": string}]. ' +
  'Débitos/compras = "expense"; créditos/entradas = "receivable". Ignore saldos e cabeçalhos. Extrato:\n\n';

function parseArray(text: string): unknown[] | null {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Importa um extrato PDF → extrai o texto → LLM lista os lançamentos → cadastra em lote. */
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

  // 2) LLM extrai o array de lançamentos
  let items: unknown[] | null = null;
  try {
    const { text: out } = await generateText({ model: resolveModel(DEFAULT_MODEL_KEY), prompt: PROMPT + text.slice(0, 8000) });
    items = parseArray(out);
  } catch (e) {
    log.error("finance.statement.llm", { error: e instanceof Error ? e.message : String(e) });
  }
  if (!items || items.length === 0) return Response.json({ error: "Não consegui extrair lançamentos do extrato" }, { status: 422 });

  // 3) cadastra em lote
  const rows = items
    .map((it) => {
      const o = it as Record<string, unknown>;
      const valor = Number(o.valor) || 0;
      if (valor <= 0) return null;
      const kind = o.tipo === "receivable" ? "receivable" : "expense";
      const d = o.data ? new Date(String(o.data)) : null;
      return {
        userId: session.user.id,
        description: String(o.descricao ?? "Lançamento"),
        category: o.categoria ? String(o.categoria) : null,
        amountCents: Math.round(valor * 100),
        kind: kind as "expense" | "receivable",
        dueDate: d && !isNaN(d.getTime()) ? d : null,
        paid: kind === "expense",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length) await db.insert(expense).values(rows);
  log.info("finance.statement", { userId: session.user.id, importados: rows.length });
  return Response.json({ importados: rows.length, lancamentos: rows.map((r) => ({ descricao: r.description, valor: r.amountCents / 100, tipo: r.kind })) });
}
