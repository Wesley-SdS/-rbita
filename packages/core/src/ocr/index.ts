import { settings } from "../settings";
import { log } from "../observability/logger";
import { ArquivoProtegidoError, DocumentoIlegivelError } from "../arquivos";
import { LeituraInterrompidaError, motivoDaSenha } from "../arquivos/tipos";
import { lerPdf, paginaComoImagem, senhaQueAbre, temCamadaDeTexto } from "./pdf";
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
  /** a página precisava do modelo de visão e não teve: por quê (config ou falha) */
  aviso?: string;
}

export interface DocumentoLido {
  paginas: PaginaLida[];
  /** texto por página, na ordem, pronto para a indexação */
  textos: string[];
  resumo: { nativas: number; ocr: number; visao: number; vazias: number; confiancaMedia: number | null };
  /** o PDF tinha senha e uma das cadastradas abriu (qual, nunca se diz) */
  abertoComSenha?: boolean;
  /** a POSIÇÃO, na lista recebida, da senha que abriu: só ela é marcada como usada (M17) */
  senhaUsada?: number;
  /**
   * O que o leitor avisou: páginas cortadas no teto, HEIC sem OCR, aberto com
   * senha, macros ignoradas, tabela cortada. Antes o `lerDocumento` jogava isso
   * fora, e um extrato de 3.000 linhas virava 2.000 sem ninguém saber (I7).
   */
  avisos?: string[];
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
  /** de quem é a conta quando a página precisa ser relida por um modelo de visão */
  userId?: string;
  /** senhas a tentar num arquivo protegido (as do remetente, cadastradas na tela) */
  senhas?: readonly string[];
  /** o arquivo não veio de e-mail: a frase de "tem senha" não manda cadastrar (I16) */
  semRemetente?: boolean;
  /** quem pediu desistiu de esperar: para na próxima página */
  sinal?: AbortSignal;
}

/**
 * Qualquer arquivo vira páginas de texto.
 *
 * O tipo é decidido pelos BYTES (armadilha 16 do PRD de anexos): um DOCX
 * renomeado para ".pdf" é lido como Word, e um ".pdf" que é executável nunca
 * é aberto. PDF e imagem seguem o pipeline do R5 (texto, OCR, visão); todo o
 * resto vai para o extrator universal (`arquivos/extrair.ts`). Antes disso,
 * qualquer coisa que não fosse PDF nem imagem virava `toString("utf-8")`: um
 * DOCX chegava ao modelo e ao índice como lixo binário, sem erro nenhum.
 */
export async function lerDocumento(bytes: Buffer, opcoes: Opcoes): Promise<DocumentoLido> {
  // import tardio: o extrator usa este módulo para PDF e imagem
  const { detectarTipo } = await import("../arquivos/detectar");
  const tipo = await detectarTipo(bytes, opcoes.nome, opcoes.mime);

  // TUDO numa thread com teto (B5), PDF e imagem inclusive: antes os dois rodavam no
  // laço principal (pdfjs, tesseract), e um PDF montado para travar o parser parava o
  // api pelo indexar, pelo cupom e pelo extrato (I7 da auditoria). Fora do e-mail não
  // há remetente para escolher senha (`semRemetente`, I16), a menos que quem chama traga as dele.
  const { extrairIsolado } = await import("../arquivos/isolado");
  const ex = await extrairIsolado(bytes, { nome: opcoes.nome, mimeDeclarado: opcoes.mime, userId: opcoes.userId, senhas: opcoes.senhas, semRemetente: opcoes.semRemetente ?? !opcoes.senhas?.length, progresso: opcoes.progresso, sinal: opcoes.sinal, tipo });
  if (ex.protegido) throw new ArquivoProtegidoError(ex.protegido.motivo);
  if (!ex.lido || !ex.texto.trim()) throw new DocumentoIlegivelError(ex.resumo);
  const avisos = ex.avisos.length ? { avisos: ex.avisos } : {};
  const senha = ex.senhaUsada !== undefined ? { abertoComSenha: true, senhaUsada: ex.senhaUsada } : {};
  if (ex.documento) {
    // PDF e imagem: o detalhe por página do pipeline do R5, como sempre foi
    return { paginas: ex.documento.paginas, textos: ex.documento.paginas.map((p) => p.texto), resumo: ex.documento.resumo, ...senha, ...avisos };
  }
  const partes = ex.partes.filter((p) => p.trim()).length ? ex.partes.filter((p) => p.trim()) : [ex.texto];
  return {
    paginas: partes.map((texto, i) => ({ numero: i + 1, texto, origem: "texto" as const, confianca: null, tabelas: 0 })),
    textos: partes,
    resumo: { nativas: partes.length, ocr: 0, visao: 0, vazias: 0, confiancaMedia: null },
    ...senha,
    ...avisos,
  };
}

/** O pipeline do R5 para PDF e imagem. O extrator universal também chama este, nunca o `lerDocumento`. */
export async function lerPdfOuImagem(bytes: Buffer, opcoes: Opcoes & { ehPdf: boolean }): Promise<DocumentoLido> {
  const cfg = await settings.getMany([
    "ocr.enabled", "ocr.minPageConfidence", "ocr.minChars", "ocr.maxLowWordRatio",
    "ocr.renderScale", "ocr.maxPages", "ocr.languages", "ocr.tableMinRows", "ocr.tableMinColumns",
  ]);
  const limites = {
    minConfianca: cfg["ocr.minPageConfidence"],
    minChars: cfg["ocr.minChars"],
    maxFracaoRuim: cfg["ocr.maxLowWordRatio"],
  };
  const ehPdf = opcoes.ehPdf;
  const paginas: PaginaLida[] = [];

  if (!ehPdf) {
    // HEIC (a foto do iPhone): o Tesseract não decodifica o formato, e não há conversor
    // instalado aqui. Quem lê é só o modelo de visão, e só se o provedor aceitar HEIC
    // (o Gemini aceita; OpenAI e Claude recusam). O limite vai DITO, nunca em silêncio (M8).
    const heic = /hei[cf]/i.test(opcoes.mime);
    const avisosDaImagem = heic ? [AVISO_HEIC] : [];
    // imagem solta (foto de cupom, print): OCR e, se ficou ruim, visão
    await opcoes.progresso?.(0, 2, "lendo o texto da imagem");
    const r = cfg["ocr.enabled"] && !heic ? await ocrImagem(bytes, { idiomas: cfg["ocr.languages"] }).catch(() => null) : null;
    let texto = r?.texto?.trim() ?? "";
    let origem: OrigemDaPagina = r ? "ocr" : "imagem";
    let aviso: string | undefined;
    const decisao = precisaDeVisao({ texto, confianca: r?.confianca ?? 0, fracaoRuim: r?.fracaoRuim ?? 1 }, limites);
    if (decisao.precisa) {
      await opcoes.progresso?.(1, 2, "olhando a imagem com o modelo de visão");
      const visao = await lerComVisao(bytes, opcoes.mime, opcoes.userId).catch((e) => {
        aviso = e instanceof Error ? e.message : String(e);
        log.error("ocr.visao.falhou", { error: aviso });
        return null;
      });
      if (visao && visao.texto.length > texto.length) {
        texto = visao.texto;
        origem = "visao";
      }
    }
    if (!texto) throw new DocumentoIlegivelError(heic ? `Não consegui ler texto nesta imagem. ${AVISO_HEIC}` : "Não consegui ler texto nesta imagem.");
    paginas.push({ numero: 1, texto, origem, confianca: r?.confianca ?? null, tabelas: 0, ...(aviso ? { aviso } : {}) });
    return {
      paginas,
      textos: [texto],
      resumo: { nativas: 0, ocr: origem === "ocr" ? 1 : 0, visao: origem === "visao" ? 1 : 0, vazias: 0, confiancaMedia: r?.confianca ?? null },
      ...(avisosDaImagem.length ? { avisos: avisosDaImagem } : {}),
    };
  }

  // PDF de banco costuma vir com senha (dígitos do CPF): tenta as do remetente,
  // e a senha que abriu nunca sai daqui (nem no erro, nem no log)
  const senha = await senhaQueAbre(new Uint8Array(bytes), opcoes.senhas ?? []);
  if (senha === null) throw new ArquivoProtegidoError(motivoDaSenha("Este PDF", opcoes.senhas, opcoes.semRemetente));
  const doPdf = await lerPdf(new Uint8Array(bytes), senha);
  const total = Math.min(doPdf.length, cfg["ocr.maxPages"]);
  // o teto de páginas corta, e o corte é DITO: antes a página 101 sumia sem aviso (M7)
  const avisos = doPdf.length > total ? [`O PDF tem ${doPdf.length} páginas; li as primeiras ${total} (Ajustes, OCR, "Teto de páginas por documento").`] : [];
  const confiancas: number[] = [];

  for (let i = 0; i < total; i++) {
    const pagina = doPdf[i]!;
    if (opcoes.sinal?.aborted) throw new LeituraInterrompidaError();
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
      imagem = await paginaComoImagem(new Uint8Array(bytes), pagina.numero, cfg["ocr.renderScale"], senha);
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
    let aviso: string | undefined;
    if (r) confiancas.push(r.confianca);

    const decisao = precisaDeVisao({ texto, confianca: r?.confianca ?? 0, fracaoRuim: r?.fracaoRuim ?? 1 }, limites);
    if (decisao.precisa) {
      await opcoes.progresso?.(i, total, `página ${pagina.numero}: lendo com o modelo de visão`);
      const visao = await lerComVisao(imagem, "image/png", opcoes.userId).catch((e) => {
        aviso = e instanceof Error ? e.message : String(e);
        log.error("ocr.visao.falhou", { pagina: pagina.numero, error: aviso });
        return null;
      });
      if (visao && visao.texto.length > texto.length) {
        texto = visao.texto;
        origem = "visao";
      }
      log.info("ocr.fallback", { pagina: pagina.numero, motivo: decisao.motivo, usou: origem });
    }
    paginas.push({ numero: pagina.numero, texto, origem, confianca: r?.confianca ?? null, tabelas: 0, ...(aviso ? { aviso } : {}) });
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
    ...(senha ? { abertoComSenha: true, senhaUsada: (opcoes.senhas ?? []).indexOf(senha) } : {}),
    ...(avisos.length ? { avisos } : {}),
  };
}

const AVISO_HEIC = "É uma foto HEIC (formato do iPhone): o OCR local não lê HEIC, só o modelo de visão, e só se o provedor aceitar o formato (o Gemini aceita; OpenAI e Claude não). Se não sair texto, mande a foto como JPG.";

export { ocrImagem, ocrImage, encerrarOcr, confiancaDaPagina } from "./tesseract";
export { temCamadaDeTexto } from "./pdf";
export { textoComTabelas, agruparEmLinhas, detectarTabelas, paraMarkdown } from "./tabela";
export { lerComVisao, ondeLer } from "./visao";
export { DocumentoIlegivelError } from "../arquivos";
