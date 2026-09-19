import { ingestPaginas, hashArquivo, type Progresso, type IngestResultado } from "./ingest";
import { lerDataUrl, DocumentoIlegivelError } from "../arquivos";
import { lerDocumento, type DocumentoLido } from "../ocr/index";

/**
 * Arquivo (PDF, imagem ou texto) vira documento indexado, PÁGINA A PÁGINA.
 *
 * O que mudou com o R5: a leitura não é mais "extrai texto do PDF e pronto".
 * Cada página é resolvida do jeito dela (texto nativo, OCR, modelo de visão), a
 * página é gravada em cada trecho, e o arquivo inteiro ganha um SHA-256 para o
 * mesmo documento não ser indexado duas vezes.
 */

export interface ArquivoIndexado extends IngestResultado {
  title: string;
  source: string;
  leitura: DocumentoLido["resumo"];
}

export interface TextoExtraido {
  text: string;
  source: "pdf" | "ocr" | "file";
  paginas: string[];
  leitura: DocumentoLido["resumo"];
}

/** Compatível com quem só quer o texto (rotas antigas, testes). */
export async function extractFileText(dataUrl: string, nome: string, progresso?: Progresso): Promise<TextoExtraido> {
  const arquivo = lerDataUrl(dataUrl);
  if (!arquivo) throw new DocumentoIlegivelError("Arquivo inválido.");
  const lido = await lerDocumento(arquivo.bytes, { nome, mime: arquivo.mime, progresso });
  const origemPrincipal = lido.resumo.ocr + lido.resumo.visao > lido.resumo.nativas ? "ocr" : lido.paginas[0]?.origem === "texto" ? "file" : "pdf";
  return { text: lido.textos.join("\n\n"), source: origemPrincipal as TextoExtraido["source"], paginas: lido.textos, leitura: lido.resumo };
}

export async function indexFile(userId: string, dataUrl: string, nome: string, progresso?: Progresso): Promise<ArquivoIndexado> {
  const arquivo = lerDataUrl(dataUrl);
  if (!arquivo) throw new DocumentoIlegivelError("Arquivo inválido.");

  const hash = hashArquivo(arquivo.bytes);
  await progresso?.(0, 3, "lendo o arquivo");
  const lido = await lerDocumento(arquivo.bytes, {
    nome,
    mime: arquivo.mime,
    // a leitura é a etapa 1 de 3; ela reporta o progresso por página dentro dela
    progresso: progresso ? async (feito, total, passo) => progresso(feito / Math.max(1, total ?? 1), 3, passo) : undefined,
  });

  const origem = lido.resumo.visao > 0 ? "visao" : lido.resumo.ocr > 0 ? "ocr" : lido.paginas[0]?.origem === "texto" ? "text" : "pdf";
  const res = await ingestPaginas(userId, nome, lido.textos, {
    source: origem,
    fileHash: hash,
    progresso: progresso ? (feito, _t, passo) => progresso(feito + 1, 3, passo) : undefined,
  });
  return { title: nome, source: origem, leitura: lido.resumo, ...res };
}

export { DocumentoIlegivelError };
