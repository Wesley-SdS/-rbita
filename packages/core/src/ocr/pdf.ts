import { log } from "../observability/logger";

/**
 * PDF: texto por página, itens posicionados e página virada em imagem.
 *
 * O ponto central é a leitura ser POR PÁGINA. O caminho antigo usava
 * `mergePages: true`, que cola tudo: a citação perdia a página, e um PDF
 * escaneado (sem camada de texto) virava simplesmente "nenhum texto extraído",
 * em vez de ir para o OCR.
 */

export interface ItemTexto {
  texto: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  novaLinha?: boolean;
}

export interface PaginaPdf {
  numero: number;
  texto: string;
  itens: ItemTexto[];
}

interface UnpdfItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

/** Carrega o unpdf sob demanda (é pesado e nem todo caminho precisa dele). */
async function unpdf() {
  return import("unpdf");
}

export async function lerPdf(bytes: Uint8Array): Promise<PaginaPdf[]> {
  const { getDocumentProxy, extractText } = await unpdf();
  const pdf = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const textos = Array.isArray(text) ? text : [text];

  const paginas: PaginaPdf[] = [];
  for (let n = 1; n <= totalPages; n++) {
    paginas.push({ numero: n, texto: textos[n - 1] ?? "", itens: [] });
  }

  // itens posicionados: é o que permite reconhecer tabela em PDF nativo
  try {
    const { extractTextItems } = await unpdf();
    // `extractTextItems` devolve { totalPages, items }, não o array direto. Iterar
    // o objeto estourava dentro do try e o catch engolia: os itens posicionados
    // ficavam sempre vazios e a extração de tabela nunca rodava de verdade.
    const { items: porPagina } = await extractTextItems(pdf);
    porPagina.forEach((itens: UnpdfItem[], i: number) => {
      const pagina = paginas[i];
      if (!pagina) return;
      pagina.itens = itens
        .filter((it) => typeof it.str === "string" && it.str.trim())
        .map((it) => ({
          texto: it.str!,
          x: it.transform?.[4] ?? 0,
          y: it.transform?.[5] ?? 0,
          largura: it.width ?? 0,
          altura: it.height ?? 0,
          novaLinha: it.hasEOL,
        }));
    });
  } catch (e) {
    // sem posições ainda dá para indexar: só perdemos a extração de tabela
    log.error("ocr.pdf.itens", { error: e instanceof Error ? e.message : String(e) });
  }

  return paginas;
}

/**
 * A página tem camada de texto aproveitável?
 *
 * Três sinais, e não só "tem texto": PDF de scanner às vezes traz uma camada
 * mínima (carimbo, número de página), e PDF com fonte sem mapa de caracteres
 * devolve texto que parece existir e é lixo (`�`, `(cid:NN)`).
 * Puro, porque é a decisão que manda (ou não) a página para o OCR.
 */
export function temCamadaDeTexto(texto: string, minChars: number): boolean {
  const limpo = (texto ?? "").trim();
  if (limpo.length < minChars) return false;
  const quebrados = (limpo.match(/�|\(cid:\d+\)/g) ?? []).length;
  if (quebrados > limpo.length / 50) return false;
  // texto legível tem letras: uma página só com pontilhado de sumário não conta
  const letras = (limpo.match(/[\p{L}]/gu) ?? []).length;
  return letras >= minChars / 2;
}

/**
 * Renderiza a página como PNG para o OCR e para o modelo de visão.
 * Requer `@napi-rs/canvas` (binário pronto, sem Cairo nem Poppler).
 */
export async function paginaComoImagem(bytes: Uint8Array, pagina: number, escala: number): Promise<Buffer> {
  const { renderPageAsImage } = await unpdf();
  const buffer = await renderPageAsImage(bytes, pagina, {
    scale: escala,
    canvasImport: () => import("@napi-rs/canvas") as never,
  });
  return Buffer.from(buffer as ArrayBuffer);
}
