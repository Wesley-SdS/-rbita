import { generateObject, generateText } from "ai";
import { z } from "zod";
import { resolveModel, resolveVisionModel, DEFAULT_MODEL_KEY } from "@orbita/llm";
import { db } from "@/lib/db";
import { expense } from "@/lib/db/finance-schema";
import { getSession } from "@/lib/session";
import { log } from "@/lib/observability/logger";
import { parseYmd } from "@/lib/finance/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ReceiptSchema = z.object({
  descricao: z.string().describe("descrição curta do estabelecimento/compra"),
  valor: z.number().describe("valor total em reais (ponto decimal); 0 se não achar"),
  categoria: z.string().describe("categoria do gasto (ex: Alimentação, Transporte)"),
  tipo: z.enum(["expense", "payable", "receivable"]).describe("expense=já pago; payable=a vencer; receivable=a receber"),
  vencimento: z.string().nullable().describe("data YYYY-MM-DD ou null"),
});

const INSTRUCAO =
  "Extraia os dados do comprovante/cupom fiscal a seguir. Regras: cupom de compra já paga = expense; " +
  "boleto/fatura a vencer = payable; nota a receber = receivable. Se não achar o valor total, use 0.\n\nTexto:\n\n";

/** Comprovante/cupom (imagem) → OCR (ou visão) → LLM estrutura → cadastra. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Imagem ausente" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());

  // 1) OCR (tesseract pt+en); se vier vazio/curto, cai para o modelo de visão.
  let ocrText = "";
  try {
    const { ocrImage } = await import("@/lib/ocr");
    ocrText = (await ocrImage(buf)).trim();
  } catch (e) {
    log.error("finance.receipt.ocr", { error: e instanceof Error ? e.message : String(e) });
  }
  if (ocrText.length < 10) {
    try {
      const dataUrl = `data:${file.type || "image/png"};base64,${buf.toString("base64")}`;
      const { text } = await generateText({
        model: resolveVisionModel(),
        messages: [{ role: "user", content: [
          { type: "text", text: "Transcreva TODO o texto visível deste comprovante/cupom (valores, itens, datas)." },
          { type: "image", image: dataUrl },
        ] }],
      });
      if (text.trim().length > ocrText.length) ocrText = text.trim();
    } catch (e) {
      log.error("finance.receipt.vision", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (ocrText.length < 3) return Response.json({ error: "Não consegui ler texto na imagem" }, { status: 422 });

  // 2) LLM estrutura os campos (structured output validado por schema)
  let fields: z.infer<typeof ReceiptSchema> | null = null;
  try {
    const { object } = await generateObject({
      model: resolveModel(DEFAULT_MODEL_KEY),
      schema: ReceiptSchema,
      prompt: INSTRUCAO + ocrText.slice(0, 6000),
    });
    fields = object;
  } catch (e) {
    log.error("finance.receipt.llm", { error: e instanceof Error ? e.message : String(e) });
  }
  if (!fields) return Response.json({ error: "Não consegui interpretar o comprovante", ocrText }, { status: 422 });

  const valor = Number.isFinite(fields.valor) ? fields.valor : 0;
  const dueDate = parseYmd(fields.vencimento);

  // 3) cadastra
  const [row] = await db
    .insert(expense)
    .values({
      userId: session.user.id,
      description: fields.descricao || "Comprovante",
      category: fields.categoria || null,
      amountCents: Math.round(valor * 100),
      kind: fields.tipo,
      dueDate,
      paid: fields.tipo === "expense",
    })
    .returning({ id: expense.id });

  log.info("finance.receipt", { userId: session.user.id, kind: fields.tipo, valor });
  return Response.json({
    id: row?.id,
    lancamento: { descricao: fields.descricao, valor, categoria: fields.categoria, tipo: fields.tipo, vencimento: fields.vencimento ?? null },
    ocrText,
  });
}
