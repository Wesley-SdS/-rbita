import { settings } from "../settings";
import { log } from "../observability/logger";
import { DocumentoIlegivelError } from "../arquivos";
import { lerPdf, paginaComoImagem, temCamadaDeTexto } from "./pdf";
import { ocrImagem } from "./tesseract";
import { textoComTabelas } from "./tabela";
import { lerComVisao } from "./visao";

/**
 * PIPELINE DE LEITURA DE DOCUMENTO (R5).
 *
 * A decisão é POR PÁGINA, não por arquivo, porque documento real é misturado:
 * um contrato assinado costuma ter 16 páginas nativas e uma foto da assinatura
 * no fim, e um PDF de banco pode ser nativo até a metade.
 *
 *   página com camada de texto  → usa o texto (e remonta a tabela pela posição)
 *   página sem texto            → renderiza e roda o OCR local
 *   OCR com confiança baixa     → modelo de visão lê a página (se permitido)
 *
 * O resultado é uma lista de páginas, que é o que a indexação precisa para
 * gravar "isto veio da página 4" em cada trecho.
 */

export type OrigemDaPagina = "pdf" | "ocr" | "visao" | "texto" | "imagem";

export interface PaginaLida {
  numero: number;
  texto: string;
  origem: OrigemDaPagina;
  /** 0 a 1 quando passou pelo OCR; nulo quando o texto era nativo */
  confianca: number | null;
  tabelas: number;
}

export interface DocumentoLido {
  paginas: PaginaLida[];
  /** texto por página, na ordem, pronto para a indexação */
  textos: string[];
  resumo: { nativas: number; ocr: number; visao: number; vazias: number; confiancaMedia: number | null };
}

export type Progresso = (feito: number, total: number | null, passo: string) => Promise<void>;

/**
 * A página precisa do modelo de visão? Puro, e é o coração do R5: é aqui que
 * "li mal" vira uma decisão, em vez de ficar escondido num texto ruim.
 *
 * Três motivos independentes, todos configuráveis: confiança média baixa,
 * texto curto demais para uma página, ou muitas palavras individualmente ruins
 * (o caso da tabela, em que a média engana).
 */
export function precisaDeVisao(
  r: { texto: string; confianca: number; fracaoRuim: number },
  limites: { minConfianca: number; minChars: number; maxFracaoRuim: number },
): { precisa: boolean; motivo: string | null } {
  const chars = r.texto.trim().length;
  if (chars < limites.minChars) return { precisa: true, motivo: "texto_curto" };
  if (r.confianca < limites.minConfianca) return { precisa: true, motivo: "confianca_baixa" };
  if (r.fracaoRuim > limites.maxFracaoRuim) return { precisa: true, motivo: "muitas_palavras_ruins" };
  return { precisa: false, motivo: null };
}

interface Opcoes {
  nome: string;
  mime: string;
  progresso?: Progresso;
}

export async function lerDocumento(bytes: Buffer, opcoes: Opcoes): Promise<DocumentoLido> {
  const cfg = await settings.getMany([
    "ocr.enabled", "ocr.minPageConfidence", "ocr.minChars", "ocr.maxLowWordRatio",
    "ocr.renderScale", "ocr.maxPages", "ocr.languages", "ocr.tableMinRows", "ocr.tableMinColumns",
  ]);
  const limites = {
    minConfianca: cfg["ocr.minPageConfidence"],
    minChars: cfg["ocr.minChars"],
    maxFracaoRuim: cfg["ocr.maxLowWordRatio"],
  };
  const ehPdf = opcoes.mime === "application/pdf" || opcoes.nome.toLowerCase().endsWith(".pdf");
  const paginas: PaginaLida[] = [];

  if (!ehPdf && !opcoes.mime.startsWith("image/")) {
    // texto puro: uma página só, sem OCR nenhum
    const texto = bytes.toString("utf-8");
    if (!texto.trim()) throw new DocumentoIlegivelError("Arquivo de texto vazio.");
    return {
      paginas: [{ numero: 1, texto, origem: "texto", confianca: null, tabelas: 0 }],
      textos: [texto],
      resumo: { nativas: 1, ocr: 0, visao: 0, vazias: 0, confiancaMedia: null },
    };
  }

  if (!ehPdf) {
    // imagem solta (foto de cupom, print): OCR e, se ficou ruim, visão
    await opcoes.progresso?.(0, 2, "lendo o texto da imagem");
    const r = cfg["ocr.enabled"] ? await ocrImagem(bytes, { idiomas: cfg["ocr.languages"] }).catch(() => null) : null;
    let texto = r?.texto?.trim() ?? "";
    let origem: OrigemDaPagina = r ? "ocr" : "imagem";
    const decisao = precisaDeVisao({ texto, confianca: r?.confianca ?? 0, fracaoRuim: r?.fracaoRuim ?? 1 }, limites);
    if (decisao.precisa) {
      await opcoes.progresso?.(1, 2, "olhando a imagem com o modelo de visão");
      const visao = await lerComVisao(bytes, opcoes.mime).catch((e) => {
        log.error("ocr.visao.falhou", { error: e instanceof Error ? e.message : String(e) });
        return null;
      });
      if (visao && visao.texto.length > texto.length) {
        texto = visao.texto;
        origem = "visao";
      }
    }
    if (!texto) throw new DocumentoIlegivelError("Não consegui ler texto nesta imagem.");
    paginas.push({ numero: 1, texto, origem, confianca: r?.confianca ?? null, tabelas: 0 });
    return {
      paginas,
      textos: [texto],
      resumo: { nativas: 0, ocr: origem === "ocr" ? 1 : 0, visao: origem === "visao" ? 1 : 0, vazias: 0, confiancaMedia: r?.confianca ?? null },
    };
  }

  const doPdf = await lerPdf(new Uint8Array(bytes));
  const total = Math.min(doPdf.length, cfg["ocr.maxPages"]);
  const confiancas: number[] = [];

  for (let i = 0; i < total; i++) {
    const pagina = doPdf[i]!;
    await opcoes.progresso?.(i, total, `lendo a página ${i + 1} de ${total}`);

    if (temCamadaDeTexto(pagina.texto, limites.minChars)) {
      const { texto, tabelas } = textoComTabelas(pagina.itens, pagina.texto, {
        minLinhas: cfg["ocr.tableMinRows"],
        minColunas: cfg["ocr.tableMinColumns"],
      });
      paginas.push({ numero: pagina.numero, texto, origem: "pdf", confianca: null, tabelas });
      continue;
    }

    if (!cfg["ocr.enabled"]) {
      paginas.push({ numero: pagina.numero, texto: pagina.texto, origem: "pdf", confianca: null, tabelas: 0 });
      continue;
    }

    // página escaneada: vira imagem e passa pelo OCR
    let imagem: Buffer | null = null;
    try {
      imagem = await paginaComoImagem(new Uint8Array(bytes), pagina.numero, cfg["ocr.renderScale"]);
    } catch (e) {
      log.error("ocr.render", { pagina: pagina.numero, error: e instanceof Error ? e.message : String(e) });
    }
    if (!imagem) {
      paginas.push({ numero: pagina.numero, texto: pagina.texto, origem: "pdf", confianca: null, tabelas: 0 });
      continue;
    }

    const r = await ocrImagem(imagem, { idiomas: cfg["ocr.languages"] }).catch((e) => {
      log.error("ocr.tesseract", { pagina: pagina.numero, error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    let texto = r?.texto?.trim() ?? "";
    let origem: OrigemDaPagina = "ocr";
    if (r) confiancas.push(r.confianca);

    const decisao = precisaDeVisao({ texto, confianca: r?.confianca ?? 0, fracaoRuim: r?.fracaoRuim ?? 1 }, limites);
    if (decisao.precisa) {
      await opcoes.progresso?.(i, total, `página ${pagina.numero}: lendo com o modelo de visão`);
      const visao = await lerComVisao(imagem).catch((e) => {
        log.error("ocr.visao.falhou", { pagina: pagina.numero, error: e instanceof Error ? e.message : String(e) });
        return null;
      });
      if (visao && visao.texto.length > texto.length) {
        texto = visao.texto;
        origem = "visao";
      }
      log.info("ocr.fallback", { pagina: pagina.numero, motivo: decisao.motivo, usou: origem });
    }
    paginas.push({ numero: pagina.numero, texto, origem, confianca: r?.confianca ?? null, tabelas: 0 });
  }

  const textos = paginas.map((p) => p.texto);
  if (!textos.join("").trim()) throw new DocumentoIlegivelError("Não consegui extrair texto deste documento.");
  return {
    paginas,
    textos,
    resumo: {
      nativas: paginas.filter((p) => p.origem === "pdf").length,
      ocr: paginas.filter((p) => p.origem === "ocr").length,
      visao: paginas.filter((p) => p.origem === "visao").length,
      vazias: paginas.filter((p) => !p.texto.trim()).length,
      confiancaMedia: confiancas.length ? confiancas.reduce((s, c) => s + c, 0) / confiancas.length : null,
    },
  };
}

export { ocrImagem, ocrImage, encerrarOcr, confiancaDaPagina } from "./tesseract";
export { temCamadaDeTexto } from "./pdf";
export { textoComTabelas, agruparEmLinhas, detectarTabelas, paraMarkdown } from "./tabela";
export { lerComVisao, ondeLer } from "./visao";
export { DocumentoIlegivelError } from "../arquivos";
