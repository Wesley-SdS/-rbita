import { ingestDocument, type Progresso } from "./ingest";
import { lerDataUrl, DocumentoIlegivelError } from "../finance/documents";

/**
 * Arquivo (PDF, imagem por OCR ou texto) vira documento indexado. Saiu da rota
 * de upload para cá ao virar trabalho de fila: extrair texto de um PDF grande
 * ou rodar OCR numa foto não cabe numa requisição HTTP.
 */

export interface TextoExtraido {
  text: string;
  source: "pdf" | "ocr" | "file";
}

export async function extractFileText(dataUrl: string, nome: string): Promise<TextoExtraido> {
  const arquivo = lerDataUrl(dataUrl);
  if (!arquivo) throw new DocumentoIlegivelError("Arquivo inválido.");
  try {
    if (nome.toLowerCase().endsWith(".pdf") || arquivo.mime === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(arquivo.bytes));
      const r = await extractText(pdf, { mergePages: true });
      return { text: Array.isArray(r.text) ? r.text.join("\n") : r.text, source: "pdf" };
    }
    if (arquivo.mime.startsWith("image/")) {
      const { ocrImage } = await import("../ocr");
      return { text: await ocrImage(arquivo.bytes), source: "ocr" };
    }
    return { text: arquivo.bytes.toString("utf-8"), source: "file" };
  } catch (e) {
    throw new DocumentoIlegivelError(`Falha ao extrair texto: ${e instanceof Error ? e.message : "erro desconhecido"}`);
  }
}

export async function indexFile(userId: string, dataUrl: string, nome: string, progresso?: Progresso) {
  await progresso?.(0, 3, "extraindo o texto do arquivo");
  const { text, source } = await extractFileText(dataUrl, nome);
  if (!text.trim()) throw new DocumentoIlegivelError("Nenhum texto extraído do arquivo.");
  // as duas etapas do ingest viram as etapas 2 e 3 deste trabalho
  const res = await ingestDocument(userId, nome, text, source, progresso ? (feito, _t, passo) => progresso(feito + 1, 3, passo) : undefined);
  return { title: nome, source, ...res };
}
