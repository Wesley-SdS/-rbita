import { z } from "zod";
import { modeloDaCasa } from "../llm/gerar";
import { registrarUso, FLUXO } from "../usage/registrar";
import type { RelatoDeUso } from "../meetings/structured";
import { db } from "@orbita/db";
import { expense } from "@orbita/db/finance-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { generateStructured } from "../meetings/structured";
import { parseYmd } from "./date";
import { lerDocumento } from "../ocr/index";

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

// A leitura de data URL e o erro de "não consegui ler" moraram aqui primeiro;
// hoje são de todo mundo que recebe arquivo (ver arquivos.ts). Reexportados
// para não quebrar quem já importava daqui.
import { lerDataUrl, DocumentoIlegivelError } from "../arquivos";
export { lerDataUrl, DocumentoIlegivelError };

/** Separador entre páginas lidas (escrito assim para não virar byte solto num patch). */
const QUEBRA = String.fromCharCode(10);

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

export interface ReceiptResult {
  id: string | undefined;
  lancamento: { descricao: string; valor: number; categoria: string; tipo: string; vencimento: string | null };
  ocrText: string;
}

export async function importReceipt(userId: string, dataUrl: string, progresso?: Progresso): Promise<ReceiptResult> {
  const arquivo = lerDataUrl(dataUrl);
  if (!arquivo) throw new DocumentoIlegivelError("Imagem inválida.");

  // 1) leitura do comprovante pelo pipeline do R5: OCR local com CONFIANÇA e,
  // quando a página sai ruim, o modelo de visão. O gatilho antigo era "menos de
  // 10 caracteres", que deixava passar cupom lido pela metade: valor e data
  // errados entravam no financeiro sem ninguém perceber.
  await progresso?.(0, 3, "lendo o texto da imagem");
  let ocrText = "";
  try {
    const lido = await lerDocumento(arquivo.bytes, { nome: "comprovante", mime: arquivo.mime, progresso, userId });
    ocrText = lido.textos.join(QUEBRA).trim();
  } catch (e) {
    log.error("finance.receipt.ocr", { error: e instanceof Error ? e.message : String(e) });
  }

  if (ocrText.length < 3) throw new DocumentoIlegivelError("Não consegui ler texto na imagem.");

  // 2) o modelo estrutura os campos
  await progresso?.(2, 3, "interpretando o comprovante");
  const { model, modelKey } = await modeloDaCasa();
  const comecou = Date.now();
  let entrada = 0;
  let saida = 0;
  const aoUsar: RelatoDeUso = (u) => { entrada += u.inputTokens ?? 0; saida += u.outputTokens ?? 0; };
  let fields: z.infer<typeof ReceiptSchema>;
  try {
    fields = await generateStructured(model, INSTRUCAO_CUPOM + ocrText.slice(0, 6000), ReceiptSchema, aoUsar);
    registrarUso({ userId, fluxo: FLUXO.financas, referencia: "comprovante", modelKey, consumo: { unidade: "tokens", entrada, saida }, duracaoMs: Date.now() - comecou });
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

  // 1) leitura pelo pipeline do R5: página com texto usa o texto (e a tabela
  // vira tabela); página escaneada passa pelo OCR. Antes, extrato escaneado
  // batia num "PDF sem texto extraível" e o dono não tinha o que fazer.
  await progresso?.(0, 2, "lendo o arquivo");
  let text = "";
  try {
    const lido = await lerDocumento(arquivo.bytes, { nome, mime: arquivo.mime, progresso, userId });
    // a página vai marcada: um lançamento cortado entre blocos continua
    // rastreável, e o modelo não junta linhas de páginas diferentes sem saber
    text = lido.paginas.map((p) => `--- Página ${p.numero} ---${QUEBRA}${p.texto}`).join(QUEBRA + QUEBRA);
  } catch (e) {
    log.error("finance.statement.parse", { error: e instanceof Error ? e.message : String(e) });
    throw new DocumentoIlegivelError(e instanceof DocumentoIlegivelError ? e.message : "Falha ao ler o arquivo.");
  }
  if (!text.trim()) throw new DocumentoIlegivelError("Não consegui extrair texto deste extrato.");

  // 2) o modelo extrai bloco a bloco (extrato longo não é truncado)
  const { model, modelKey } = await modeloDaCasa();
  const comecouExtrato = Date.now();
  let entradaExtrato = 0;
  let saidaExtrato = 0;
  const aoUsarExtrato: RelatoDeUso = (u) => { entradaExtrato += u.inputTokens ?? 0; saidaExtrato += u.outputTokens ?? 0; };
  const cfg = await settings.getMany(["finance.statementBlockChars", "finance.statementMaxBlocks"]);
  const blocks = splitBlocks(text, cfg["finance.statementBlockChars"]).slice(0, cfg["finance.statementMaxBlocks"]);
  const all: z.infer<typeof ItemSchema>[] = [];
  for (const [i, block] of blocks.entries()) {
    await progresso?.(i, blocks.length + 1, `lendo o bloco ${i + 1} de ${blocks.length}`);
    try {
      const { lancamentos } = await generateStructured(model, INSTRUCAO_EXTRATO + block, BlocoSchema, aoUsarExtrato);
      all.push(...lancamentos);
    } catch (e) {
      // bloco ruim não invalida o extrato inteiro
      log.error("finance.statement.llm", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  // a conta vai ANTES do "não consegui": ler um extrato e não entender nada
  // também custou, e é justamente o gasto que ninguém lembra de contar
  registrarUso({
    userId,
    fluxo: FLUXO.financas,
    referencia: "extrato",
    modelKey,
    consumo: { unidade: "tokens", entrada: entradaExtrato, saida: saidaExtrato },
    duracaoMs: Date.now() - comecouExtrato,
    erro: all.length === 0 ? "nenhum lançamento extraído" : null,
  });
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
