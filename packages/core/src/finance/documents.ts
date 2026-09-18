import { generateText } from "ai";
import { z } from "zod";
import { resolveModel, resolveVisionModel, fallbackModelKey } from "@orbita/llm";
import { db } from "@orbita/db";
import { expense } from "@orbita/db/finance-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { generateStructured } from "../meetings/structured";
import { parseYmd } from "./date";

/**
 * Cupom (foto) e extrato (PDF) viram lançamentos. Saiu das rotas para cá ao
 * virar trabalho de fila: OCR e uma chamada de LLM por bloco levam dezenas de
 * segundos, e o dono não tem que ficar com a aba aberta esperando.
 *
 * Na mudança, os dois deixaram de usar `generateObject`, que não funciona
 * contra o Ollama (CLAUDE.md §9: o endpoint OpenAI-compatible não garante o
 * modo estruturado que o SDK espera). Agora usam `generateStructured`, que já é
 * o padrão do resto da casa e sobrevive a modelo local.
 */

export type Progresso = (feito: number, total: number | null, passo: string) => Promise<void>;

/** Data URL "data:image/png;base64,..." → bytes + mime. */
export function lerDataUrl(dataUrl: string): { bytes: Buffer; mime: string } | null {
  const m = /^data:([\w/+.-]+)(?:;[\w=.-]+)*;base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  return { bytes: Buffer.from(m[2]!, "base64"), mime: m[1]! };
}

// ── cupom / comprovante ─────────────────────────────────────────────────────

const ReceiptSchema = z.object({
  descricao: z.string().max(200).describe("descrição curta do estabelecimento/compra"),
  valor: z.number().describe("valor total em reais (ponto decimal); 0 se não achar"),
  categoria: z.string().max(60).describe("categoria do gasto (ex: Alimentação, Transporte)"),
  tipo: z.enum(["expense", "payable", "receivable"]).describe("expense=já pago; payable=a vencer; receivable=a receber"),
  vencimento: z.string().max(20).nullable().catch(null).describe("data YYYY-MM-DD ou null"),
});

const INSTRUCAO_CUPOM =
  "Extraia os dados do comprovante/cupom fiscal a seguir. Regras: cupom de compra já paga = expense; " +
  "boleto/fatura a vencer = payable; nota a receber = receivable. Se não achar o valor total, use 0.\n\nTexto:\n\n";

export class DocumentoIlegivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentoIlegivelError";
  }
}

export interface ReceiptResult {
  id: string | undefined;
  lancamento: { descricao: string; valor: number; categoria: string; tipo: string; vencimento: string | null };
  ocrText: string;
}

export async function importReceipt(userId: string, dataUrl: string, progresso?: Progresso): Promise<ReceiptResult> {
  const arquivo = lerDataUrl(dataUrl);
  if (!arquivo) throw new DocumentoIlegivelError("Imagem inválida.");

  // 1) OCR (tesseract pt+en); se vier vazio ou curto, cai para o modelo de visão
  await progresso?.(0, 3, "lendo o texto da imagem");
  let ocrText = "";
  try {
    const { ocrImage } = await import("../ocr");
    ocrText = (await ocrImage(arquivo.bytes)).trim();
  } catch (e) {
    log.error("finance.receipt.ocr", { error: e instanceof Error ? e.message : String(e) });
  }

  if (ocrText.length < 10) {
    await progresso?.(1, 3, "olhando a imagem com o modelo de visão");
    try {
      const vis = await settings.getMany(["vision.localModel", "vision.cloudModel"]);
      const { text } = await generateText({
        model: resolveVisionModel({ local: vis["vision.localModel"], cloud: vis["vision.cloudModel"] }),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Transcreva TODO o texto visível deste comprovante/cupom (valores, itens, datas)." },
              { type: "image", image: dataUrl },
            ],
          },
        ],
      });
      if (text.trim().length > ocrText.length) ocrText = text.trim();
    } catch (e) {
      log.error("finance.receipt.vision", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (ocrText.length < 3) throw new DocumentoIlegivelError("Não consegui ler texto na imagem.");

  // 2) o modelo estrutura os campos
  await progresso?.(2, 3, "interpretando o comprovante");
  const model = resolveModel(await fallbackModelKey());
  let fields: z.infer<typeof ReceiptSchema>;
  try {
    fields = await generateStructured(model, INSTRUCAO_CUPOM + ocrText.slice(0, 6000), ReceiptSchema);
  } catch (e) {
    log.error("finance.receipt.llm", { error: e instanceof Error ? e.message : String(e) });
    throw new DocumentoIlegivelError("Li o texto, mas não consegui interpretar o comprovante.");
  }

  const valor = Number.isFinite(fields.valor) ? fields.valor : 0;
  const [row] = await db
    .insert(expense)
    .values({
      userId,
      description: fields.descricao || "Comprovante",
      category: fields.categoria || null,
      amountCents: Math.round(valor * 100),
      kind: fields.tipo,
      dueDate: parseYmd(fields.vencimento),
      paid: fields.tipo === "expense",
    })
    .returning({ id: expense.id });

  log.info("finance.receipt", { userId, kind: fields.tipo, valor });
  return {
    id: row?.id,
    lancamento: { descricao: fields.descricao, valor, categoria: fields.categoria, tipo: fields.tipo, vencimento: fields.vencimento ?? null },
    ocrText: ocrText.slice(0, 2000),
  };
}

// ── extrato ─────────────────────────────────────────────────────────────────

const ItemSchema = z.object({
  descricao: z.string().max(200),
  valor: z.number().describe("valor em reais, positivo"),
  tipo: z.enum(["expense", "receivable"]).describe("débito/compra=expense; crédito/entrada=receivable"),
  data: z.string().max(20).nullable().catch(null).describe("YYYY-MM-DD ou null"),
  categoria: z.string().max(60).catch(""),
});
const BlocoSchema = z.object({ lancamentos: z.array(ItemSchema).max(200).catch([]) });

const INSTRUCAO_EXTRATO =
  "Você recebe um trecho de EXTRATO bancário/cartão. Extraia TODOS os lançamentos deste trecho no campo `lancamentos`. " +
  "Débitos/compras = expense; créditos/entradas = receivable. Ignore saldos e cabeçalhos.\n\nTrecho:\n\n";

/** Divide o texto em blocos que cabem no contexto, cortando em quebras de linha. Puro. */
export function splitBlocks(text: string, size: number): string[] {
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

export interface StatementResult {
  importados: number;
  lancamentos: { descricao: string; valor: number; tipo: string }[];
}

export async function importStatement(userId: string, dataUrl: string, nome: string, progresso?: Progresso): Promise<StatementResult> {
  const arquivo = lerDataUrl(dataUrl);
  if (!arquivo) throw new DocumentoIlegivelError("Arquivo inválido.");

  // 1) texto do PDF (unpdf), ou texto puro
  await progresso?.(0, 2, "lendo o arquivo");
  let text = "";
  try {
    if (nome.toLowerCase().endsWith(".pdf") || arquivo.mime === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(arquivo.bytes));
      const r = await extractText(pdf, { mergePages: true });
      text = Array.isArray(r.text) ? r.text.join("\n") : r.text;
    } else {
      text = arquivo.bytes.toString("utf-8");
    }
  } catch (e) {
    log.error("finance.statement.parse", { error: e instanceof Error ? e.message : String(e) });
    throw new DocumentoIlegivelError("Falha ao ler o PDF.");
  }
  if (!text.trim()) throw new DocumentoIlegivelError("PDF sem texto extraível. Se for uma foto, mande como comprovante.");

  // 2) o modelo extrai bloco a bloco (extrato longo não é truncado)
  const model = resolveModel(await fallbackModelKey());
  const cfg = await settings.getMany(["finance.statementBlockChars", "finance.statementMaxBlocks"]);
  const blocks = splitBlocks(text, cfg["finance.statementBlockChars"]).slice(0, cfg["finance.statementMaxBlocks"]);
  const all: z.infer<typeof ItemSchema>[] = [];
  for (const [i, block] of blocks.entries()) {
    await progresso?.(i, blocks.length + 1, `lendo o bloco ${i + 1} de ${blocks.length}`);
    try {
      const { lancamentos } = await generateStructured(model, INSTRUCAO_EXTRATO + block, BlocoSchema);
      all.push(...lancamentos);
    } catch (e) {
      // bloco ruim não invalida o extrato inteiro
      log.error("finance.statement.llm", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (all.length === 0) throw new DocumentoIlegivelError("Não consegui extrair lançamentos do extrato.");

  // 3) dedup (data + valor + descrição) e cadastro em lote
  await progresso?.(blocks.length, blocks.length + 1, "cadastrando os lançamentos");
  const seen = new Set<string>();
  const rows = all
    .map((o) => {
      const valor = Number(o.valor) || 0;
      if (valor <= 0) return null;
      const key = `${o.data ?? ""}|${valor}|${(o.descricao ?? "").toLowerCase().slice(0, 40)}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        userId,
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
  log.info("finance.statement", { userId, importados: rows.length });
  return { importados: rows.length, lancamentos: rows.map((r) => ({ descricao: r.description, valor: r.amountCents / 100, tipo: r.kind })) };
}
