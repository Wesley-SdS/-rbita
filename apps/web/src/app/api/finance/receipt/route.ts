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
  "Extraia os dados do comprovante/cupom fiscal abaixo e responda APENAS um JSON válido, sem texto extra, no formato:\n" +
  '{"descricao": string, "valor": number (em reais, ponto decimal), "categoria": string, "tipo": "expense"|"payable"|"receivable", "vencimento": string|null (YYYY-MM-DD)}\n' +
  "Regras: cupom de compra já paga = expense; boleto/fatura a vencer = payable; nota a receber = receivable. " +
  "Se não achar o valor total, use 0. Texto do comprovante:\n\n";

function parseJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Comprovante/cupom (imagem) → OCR → LLM extrai → cadastra o lançamento. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Imagem ausente" }, { status: 400 });

  // 1) OCR (tesseract pt+en) — mesma engine do upload de documentos
  let ocrText = "";
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const { ocrImage } = await import("@/lib/ocr");
    ocrText = (await ocrImage(buf)).trim();
  } catch (e) {
    log.error("finance.receipt.ocr", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "Falha no OCR da imagem" }, { status: 502 });
  }
  if (!ocrText) return Response.json({ error: "Não consegui ler texto na imagem" }, { status: 422 });

  // 2) LLM extrai os campos estruturados
  let fields: Record<string, unknown> | null = null;
  try {
    const { text } = await generateText({ model: resolveModel(DEFAULT_MODEL_KEY), prompt: PROMPT + ocrText.slice(0, 4000) });
    fields = parseJson(text);
  } catch (e) {
    log.error("finance.receipt.llm", { error: e instanceof Error ? e.message : String(e) });
  }
  if (!fields) return Response.json({ error: "Não consegui interpretar o comprovante", ocrText }, { status: 422 });

  const valor = Number(fields.valor) || 0;
  const kind = ["expense", "payable", "receivable"].includes(String(fields.tipo)) ? String(fields.tipo) : "expense";
  const dueDate = fields.vencimento ? new Date(String(fields.vencimento)) : null;

  // 3) cadastra
  const [row] = await db
    .insert(expense)
    .values({
      userId: session.user.id,
      description: String(fields.descricao ?? "Comprovante"),
      category: fields.categoria ? String(fields.categoria) : null,
      amountCents: Math.round(valor * 100),
      kind: kind as "expense" | "payable" | "receivable",
      dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
      paid: kind === "expense",
    })
    .returning({ id: expense.id });

  log.info("finance.receipt", { userId: session.user.id, kind, valor });
  return Response.json({
    id: row?.id,
    lancamento: { descricao: fields.descricao, valor, categoria: fields.categoria, tipo: kind, vencimento: fields.vencimento ?? null },
    ocrText,
  });
}
