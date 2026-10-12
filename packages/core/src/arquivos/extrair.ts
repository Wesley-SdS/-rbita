import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import * as officeCryptoNs from "officecrypto-tool";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { ArquivoProtegidoError, DocumentoIlegivelError } from "../arquivos";
import { detectarTipo, extensaoDoNome } from "./detectar";
import { membro } from "./interop";
import { decodificar, lerCsv, separadorDoCsv, tabelaMarkdown, tamanhoLegivel } from "./texto";
import { htmlParaTexto } from "./leitores/html";
import { conteudoDoContainer, lerDoc, lerDocx, lerOdp, lerOdt, lerPptx, lerRtf } from "./leitores/office";
import { lerPlanilha, planilhaComoCsv, PlanilhaProtegidaError } from "./leitores/planilha";
import { emailComoExtraido, lerEml, lerMht, lerMsg, textoDoEmail, type EmailLido } from "./leitores/email";
import { lerCom7Zip, lerZip, localizar7Zip, seteZipNoDisco, type SeteZip } from "./leitores/compactado";
import { lerAudio, lerVideo, type DependenciasDaMidia } from "./leitores/midia";
import { lerIcs, lerNfe, lerVcf, textoDaNota, textoDosContatos, textoDosEventos } from "./leitores/estruturado";
import {
  CompactadoRecusadoError, LeituraInterrompidaError, avisoDoTetoDeTexto, conferirSinal, motivoDaSenha,
  type Extraido, type Limites, type OpcoesDeExtracao, type Orcamento, type TipoDetectado,
} from "./tipos";

/**
 * O EXTRATOR UNIVERSAL (PRD §8.1, C3): um só para todos os canais.
 *
 * Anexo de e-mail, documento do WhatsApp, arquivo do Telegram e "indexar
 * arquivo" passam por aqui. O tipo vem dos bytes (`detectar.ts`), cada família
 * tem o seu leitor (`leitores/`), e o que não dá para ler volta com `lido:
 * false` e um resumo que diz por quê. Nunca bytes crus para o modelo, nunca
 * nada executado: executável devolve só tipo, tamanho e hash.
 *
 * Erro de leitura NÃO sobe (vira `lido: false`), com duas exceções: o pedido
 * de parar (`LeituraInterrompidaError`) e, dentro de um compactado, o teto
 * estourado (`CompactadoRecusadoError`), que precisa recusar o arquivo de FORA
 * inteiro, e não só a parte que explodiu.
 */

export async function limitesDaConfig(): Promise<Limites> {
  const c = await settings.getMany([
    "anexos.linhasMax", "anexos.zipMaxArquivos", "anexos.zipMaxMb", "anexos.zipProfundidade",
    "anexos.tamanhoMaxMb", "anexos.transcreverAudio", "anexos.quadrosDoVideo", "anexos.seteZip", "anexos.textoMaxCaracteres",
  ]);
  return {
    linhasMax: c["anexos.linhasMax"],
    zipMaxArquivos: c["anexos.zipMaxArquivos"],
    zipMaxBytes: c["anexos.zipMaxMb"] * 1024 * 1024,
    zipProfundidade: c["anexos.zipProfundidade"],
    arquivoMaxBytes: c["anexos.tamanhoMaxMb"] * 1024 * 1024,
    transcreverAudio: c["anexos.transcreverAudio"],
    quadrosDoVideo: c["anexos.quadrosDoVideo"],
    seteZip: c["anexos.seteZip"],
    textoMax: c["anexos.textoMaxCaracteres"],
  };
}

const CHAVES_DOS_LIMITES = ["linhasMax", "zipMaxArquivos", "zipMaxBytes", "zipProfundidade", "arquivoMaxBytes", "transcreverAudio", "quadrosDoVideo", "seteZip", "textoMax"] as const satisfies readonly (keyof Limites)[];

/** Os limites já vieram todos (a thread recebe prontos; o arquivo de dentro do ZIP herda os do de fora): não há o que ler da config. */
function limitesCompletos(l: Partial<Limites> | undefined): l is Limites {
  return !!l && CHAVES_DOS_LIMITES.every((k) => l[k] !== undefined);
}

export interface OpcoesInternas extends OpcoesDeExtracao {
  /** já detectado por quem chamou (o `lerDocumento`), para não ler a assinatura duas vezes */
  tipo?: TipoDetectado;
  /** para testes: o 7-Zip e a mídia sem processo nem rede */
  seteZip?: SeteZip | null;
  midia?: DependenciasDaMidia;
}

const NOME_DA_FAMILIA: Record<string, string> = {
  docx: "Documento do Word", docm: "Documento do Word com macros (as macros não rodam)", dotx: "Modelo do Word",
  xlsx: "Planilha do Excel", xlsm: "Planilha do Excel com macros (as macros não rodam)", xls: "Planilha do Excel antiga (XLS)", ods: "Planilha do Calc (ODS)",
};

function base(nome: string, tipo: TipoDetectado, bytes: Buffer): Extraido {
  const avisos: string[] = [];
  if (tipo.divergente && tipo.declarado) avisos.push(`O nome ou o tipo declarado dizia ${tipo.declarado}, mas o arquivo é ${tipo.ext.toUpperCase()}: li pelo que ele é de verdade.`);
  return {
    nome,
    tipo,
    tamanho: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    lido: false,
    texto: "",
    partes: [],
    resumo: "",
    tabelas: 0,
    avisos,
  };
}

function naoLido(ex: Extraido, resumo: string, extra: Partial<Extraido> = {}): Extraido {
  return { ...ex, lido: false, texto: "", partes: [], resumo, ...extra };
}

/**
 * Quanto texto este arquivo pode devolver. O arquivo SOLTO (folha) gasta do
 * orçamento de texto, que é dividido entre todos os níveis; o que JUNTA os de
 * dentro (ZIP, e-mail anexado) não gasta de novo, só não passa do teto total.
 */
interface TetoDeTexto {
  orcamento?: Orcamento;
  total: number;
  /** contêiner: o texto é a soma dos de dentro, que já pagaram */
  juntaOsDeDentro?: boolean;
}

/** Corta o texto (e as partes, na mesma medida) no teto. PURO. */
export function cortarNoTeto(texto: string, partes: string[], teto: number): { texto: string; partes: string[]; cortou: boolean } {
  if (texto.length <= teto) return { texto, partes, cortou: false };
  const cortado = texto.slice(0, Math.max(0, teto));
  const out: string[] = [];
  let sobra = Math.max(0, teto);
  for (const p of partes) {
    if (sobra <= 0) break;
    out.push(p.length <= sobra ? p : p.slice(0, sobra));
    sobra -= p.length;
  }
  return { texto: cortado, partes: out, cortou: true };
}

function lido(ex: Extraido, r: { texto: string; partes?: string[]; resumo: string; tabelas?: number; avisos?: string[] }, extra: Partial<Extraido> = {}, teto?: TetoDeTexto): Extraido {
  const inteiro = r.texto.trim();
  if (!inteiro) return naoLido(ex, `${r.resumo.replace(/\.$/, "")}, mas sem texto nenhum dentro.`, { avisos: [...ex.avisos, ...(r.avisos ?? [])] });
  const avisos = [...ex.avisos, ...(r.avisos ?? []), ...(extra.avisos ?? [])];
  let texto = inteiro;
  let partes = (r.partes ?? [inteiro]).filter((p) => p.trim());
  if (teto) {
    // config faltando (um teste com mapa parcial) não vira teto zero
    const total = Number.isFinite(teto.total) ? teto.total : Number.POSITIVE_INFINITY;
    const restante = teto.juntaOsDeDentro || teto.orcamento?.texto === undefined ? total : Math.min(total, teto.orcamento.texto);
    const c = cortarNoTeto(texto, partes, restante);
    // sem sobra nenhuma: "lido" com texto vazio quebraria a regra de que lido tem texto (o cache depende dela)
    if (c.cortou && !c.texto.trim()) return naoLido(ex, `${r.resumo.replace(/\.$/, "")}; não li: o texto dos arquivos anteriores já chegou ao teto de ${teto.total.toLocaleString("pt-BR")} caracteres.`, { avisos: [...avisos, avisoDoTetoDeTexto(teto.total)] });
    if (c.cortou) {
      texto = c.texto;
      partes = c.partes;
      avisos.push(avisoDoTetoDeTexto(teto.total));
    }
    if (!teto.juntaOsDeDentro && teto.orcamento?.texto !== undefined) teto.orcamento.texto -= texto.length;
  }
  return { ...ex, lido: true, texto, partes, resumo: r.resumo, tabelas: r.tabelas ?? 0, ...extra, avisos };
}

/**
 * Office com senha (DOCX/XLSX/PPTX cifrado, XLS/DOC com senha). Devolve os
 * bytes abertos e QUAL senha abriu (a posição, para marcar só ela), ou null.
 */
async function abrirOffice(bytes: Buffer, senhas: readonly string[]): Promise<{ bytes: Buffer; senhaUsada: number } | null> {
  const decrypt = membro<(b: Buffer, o: { password: string }) => Promise<Buffer>>(officeCryptoNs, "decrypt");
  for (const [i, senha] of senhas.entries()) {
    try {
      return { bytes: Buffer.from(await decrypt(bytes, { password: senha })), senhaUsada: i };
    } catch {
      /* senha errada: a próxima */
    }
  }
  return null;
}

function cifrado(bytes: Buffer): boolean {
  try {
    return membro<(b: Buffer) => boolean>(officeCryptoNs, "isEncrypted")(bytes);
  } catch {
    return false;
  }
}

function sete(limites: Limites, opts: OpcoesInternas): SeteZip | null {
  if (opts.seteZip !== undefined) return opts.seteZip;
  const caminho = localizar7Zip(limites.seteZip);
  return caminho ? seteZipNoDisco(caminho) : null;
}

export async function extrair(bytes: Buffer | Uint8Array, opts: OpcoesInternas = {}): Promise<Extraido> {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nome = (opts.nome ?? "arquivo").slice(0, 200);
  // a thread recebe os limites prontos e o arquivo de dentro herda os do de fora: só a
  // primeira chamada lê a config (antes, CADA arquivo de um ZIP consultava o banco, M6)
  const limites: Limites = limitesCompletos(opts.limites) ? opts.limites : { ...(await limitesDaConfig()), ...(opts.limites ?? {}) };
  const profundidade = opts.profundidade ?? 0;
  const orcamento: Orcamento = opts.orcamento ?? { bytes: limites.zipMaxBytes, arquivos: limites.zipMaxArquivos, texto: limites.textoMax };
  const tipo = opts.tipo ?? (await detectarTipo(buf, nome, opts.mimeDeclarado));
  const ex = base(nome, tipo, buf);
  conferirSinal(opts.sinal);

  try {
    return await porFamilia(buf, ex, { ...opts, nome }, limites, profundidade, orcamento);
  } catch (e) {
    if (e instanceof LeituraInterrompidaError) throw e;
    if (e instanceof CompactadoRecusadoError) {
      if (profundidade > 0) throw e;
      return naoLido(ex, `Recusado. ${e.message}`);
    }
    if (e instanceof ArquivoProtegidoError) return naoLido(ex, e.message, { protegido: { motivo: e.message } });
    if (e instanceof DocumentoIlegivelError) return naoLido(ex, e.message);
    // o detalhe vai para o log (sem conteúdo do arquivo); para o modelo vai uma frase
    log.warn("arquivos.leitura_falhou", { tipo: tipo.ext, tamanho: buf.length, erro: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) });
    return naoLido(ex, `${tipo.ext.toUpperCase()} de ${tamanhoLegivel(buf.length)}: não consegui ler (o arquivo parece corrompido ou foi gravado de um jeito que eu não reconheço).`);
  }
}

/** Um arquivo de dentro que nem chega a ser aberto (passou de um teto): descrito pelo nome e pelo tamanho. */
function naoAberto(bytes: Buffer, nome: string, resumo: string): Extraido {
  const ext = extensaoDoNome(nome) || "bin";
  return { nome, tipo: { ext, mime: "application/octet-stream", familia: "desconhecido" }, tamanho: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), lido: false, texto: "", partes: [], resumo, tabelas: 0, avisos: [] };
}

async function porFamilia(buf: Buffer, ex: Extraido, opts: OpcoesInternas & { nome: string }, limites: Limites, profundidade: number, orcamento: Orcamento): Promise<Extraido> {
  const { tipo } = ex;
  const senhas = opts.senhas ?? [];
  const tam = tamanhoLegivel(buf.length);
  const folha: TetoDeTexto = { orcamento, total: limites.textoMax };
  const juntando: TetoDeTexto = { orcamento, total: limites.textoMax, juntaOsDeDentro: true };
  const temSenha = (oQue: string) => new ArquivoProtegidoError(motivoDaSenha(oQue, senhas, opts.semRemetente));

  const filho = async (b: Buffer, nomeFilho: string, prof: number): Promise<Extraido> => {
    conferirSinal(opts.sinal);
    // o texto dos de antes já encheu o teto: este nem é aberto (não gasta CPU para jogar fora)
    if (orcamento.texto !== undefined && orcamento.texto <= 0) return naoAberto(b, nomeFilho, `não li: o texto dos arquivos anteriores já chegou ao teto de ${limites.textoMax.toLocaleString("pt-BR")} caracteres`);
    return extrair(b, { ...opts, nome: nomeFilho, profundidade: prof, orcamento, limites, tipo: undefined, mimeDeclarado: null });
  };

  switch (tipo.familia) {
    case "pdf":
    case "imagem": {
      const { lerPdfOuImagem } = await import("../ocr/index");
      const r = await lerPdfOuImagem(buf, { nome: opts.nome, mime: tipo.mime, ehPdf: tipo.familia === "pdf", userId: opts.userId, senhas, semRemetente: opts.semRemetente, progresso: opts.progresso, sinal: opts.sinal });
      const avisos = [...r.paginas.filter((p) => p.aviso).map((p) => `Página ${p.numero}: ${p.aviso}`), ...(r.avisos ?? [])];
      if (r.abertoComSenha) avisos.push("Aberto com a senha cadastrada para o remetente.");
      const como = r.resumo.visao ? ", parte pelo modelo de visão" : r.resumo.ocr ? ", parte por OCR" : "";
      const resumo = tipo.familia === "pdf" ? `PDF de ${r.paginas.length} página(s)${como}.` : `Imagem (${tipo.ext.toUpperCase()}) lida${r.resumo.visao ? " pelo modelo de visão" : " por OCR"}.`;
      const tabelas = r.paginas.reduce((s, p) => s + p.tabelas, 0);
      // o detalhe por página volta junto: o `lerDocumento` (indexar, cupom, extrato) agora lê por aqui, na thread (I7)
      const senhaUsada = r.senhaUsada !== undefined ? { senhaUsada: r.senhaUsada } : {};
      return lido(ex, { texto: r.textos.map((t, i) => (r.textos.length > 1 ? `## Página ${i + 1}\n${t}` : t)).join("\n\n"), partes: r.textos, resumo, tabelas, avisos }, { documento: { paginas: r.paginas, resumo: r.resumo }, ...senhaUsada }, folha);
    }

    case "texto": {
      const t = decodificar(buf);
      if (!t) return naoLido(ex, `Arquivo de ${tam} que não é texto legível.`);
      return lido(ex, { texto: t.texto, resumo: `Texto (${tipo.ext.toUpperCase()}, ${t.codificacao}) com ${t.texto.split("\n").length} linha(s).` }, {}, folha);
    }

    case "script": {
      const t = decodificar(buf);
      if (!t) return naoLido(ex, `Script de ${tam} ilegível.`);
      return lido(ex, { texto: t.texto, resumo: `Script (${tipo.ext.toUpperCase()}) com ${t.texto.split("\n").length} linha(s). Lido como texto: nunca é executado.`, avisos: ["É um script: a Órbita só leu o texto dele, nada foi executado."] }, {}, folha);
    }

    case "tabela": {
      const t = decodificar(buf);
      if (!t) return naoLido(ex, `Tabela de ${tam} ilegível.`);
      // o extrato quer o CSV como veio, todas as linhas (o leitor dele é que separa as colunas)
      if (opts.comoCsv) return lido(ex, { texto: t.texto.replace(/^﻿/, ""), resumo: `Tabela (${tipo.ext.toUpperCase()}, ${t.codificacao}) com ${t.texto.split("\n").length} linha(s).` }, {}, folha);
      const sep = separadorDoCsv(t.texto) ?? (tipo.ext === "tsv" ? "\t" : ",");
      const { linhas, total } = lerCsv(t.texto.replace(/^﻿/, ""), sep, limites.linhasMax);
      const avisos = total > limites.linhasMax ? [`A tabela tem ${total} linhas; li as primeiras ${limites.linhasMax}.`] : [];
      return lido(ex, { texto: tabelaMarkdown(linhas), resumo: `Tabela (${tipo.ext.toUpperCase()}, ${t.codificacao}) com ${total} linha(s).`, tabelas: 1, avisos }, {}, folha);
    }

    case "html": {
      if (tipo.ext === "mht") {
        const m = await lerMht(buf);
        return lido(ex, { texto: m.texto, resumo: `Página arquivada (MHT)${m.titulo ? ` "${m.titulo}"` : ""}.`, tabelas: m.tabelas }, {}, folha);
      }
      const t = decodificar(buf);
      if (!t) return naoLido(ex, `HTML de ${tam} ilegível.`);
      const h = htmlParaTexto(t.texto);
      return lido(ex, { texto: h.texto, resumo: `Página HTML${h.tabelas ? ` com ${h.tabelas} tabela(s)` : ""} (sem scripts nem imagens remotas).`, tabelas: h.tabelas }, {}, folha);
    }

    case "documento": {
      // DOC antigo com senha guarda a criptografia DENTRO do próprio contêiner (não no EncryptedPackage)
      if (tipo.ext === "doc" && cifrado(buf)) {
        const aberto = await abrirOffice(buf, senhas);
        if (!aberto) throw temSenha("O documento");
        const r = await lerDoc(aberto.bytes);
        return lido(ex, { ...r, avisos: ["Aberto com a senha cadastrada para o remetente."] }, { senhaUsada: aberto.senhaUsada }, folha);
      }
      const r =
        tipo.ext === "odt" ? await lerOdt(buf, limites, orcamento)
        : tipo.ext === "rtf" ? lerRtf(buf)
        : tipo.ext === "doc" ? await lerDoc(buf)
        : await lerDocx(buf, limites, orcamento);
      return lido(ex, { ...r, resumo: tipo.ext === "docm" ? r.resumo.replace(/^Documento do Word/, NOME_DA_FAMILIA.docm!) : r.resumo }, tipo.ext === "docm" ? { avisos: ["Tem macros: foram ignoradas, o arquivo foi lido só como texto."] } : {}, folha);
    }

    case "planilha": {
      // só a conferência do tamanho (bomba): quem lê a planilha é o xlsx, a partir dos bytes
      if (tipo.ext !== "xls") await conteudoDoContainer(buf, limites, orcamento, () => false);
      const nomeFormato = NOME_DA_FAMILIA[tipo.ext] ?? "Planilha";
      if (opts.comoCsv) {
        // o extrato: todas as linhas, em CSV, para o leitor determinístico (I8). Com senha, abre como sempre
        let senhaUsada: number | undefined;
        let c: ReturnType<typeof planilhaComoCsv>;
        try {
          c = planilhaComoCsv(buf);
        } catch (e) {
          if (!(e instanceof PlanilhaProtegidaError)) throw e;
          const aberta = await abrirOffice(buf, senhas);
          if (!aberta) throw temSenha("A planilha");
          senhaUsada = aberta.senhaUsada;
          c = planilhaComoCsv(aberta.bytes);
        }
        return lido(ex, { texto: c.texto, resumo: `${nomeFormato} com ${c.abas} aba(s) e ${c.linhas} linha(s), em CSV.` }, senhaUsada !== undefined ? { senhaUsada } : {}, folha);
      }
      try {
        const r = lerPlanilha(buf, limites.linhasMax, nomeFormato);
        return lido(ex, r, tipo.ext === "xlsm" ? { avisos: ["Tem macros: foram ignoradas, só os valores foram lidos."] } : {}, folha);
      } catch (e) {
        if (!(e instanceof PlanilhaProtegidaError)) throw e;
        const aberta = await abrirOffice(buf, senhas);
        if (!aberta) throw temSenha("A planilha");
        const r = lerPlanilha(aberta.bytes, limites.linhasMax, nomeFormato);
        return lido(ex, { ...r, avisos: [...r.avisos, "Aberta com a senha cadastrada para o remetente."] }, { senhaUsada: aberta.senhaUsada }, folha);
      }
    }

    case "apresentacao": {
      if (tipo.ext === "ppt") return naoLido(ex, `Apresentação do PowerPoint antigo (PPT), ${tam}: não sei ler este formato. Salvo como PPTX, eu leio.`);
      const r = tipo.ext === "odp" ? await lerOdp(buf, limites, orcamento) : await lerPptx(buf, limites, orcamento);
      return lido(ex, r, {}, folha);
    }

    case "protegido": {
      // Office cifrado (o contêiner OLE com EncryptedPackage): abre com a senha e lê o que estava dentro
      const aberto = await abrirOffice(buf, senhas);
      if (!aberto) throw temSenha("O documento");
      const r = await extrair(aberto.bytes, { ...opts, profundidade, orcamento, limites, tipo: undefined, mimeDeclarado: null });
      return { ...r, nome: ex.nome, sha256: ex.sha256, tamanho: ex.tamanho, senhaUsada: aberto.senhaUsada, avisos: [...ex.avisos, ...r.avisos, "Aberto com a senha cadastrada para o remetente."] };
    }

    case "email": {
      if (profundidade > limites.zipProfundidade) return naoLido(ex, `E-mail anexado dentro de outro arquivo além de ${limites.zipProfundidade} nível(is): não abri.`);
      // cada anexo do e-mail anexado conta no MESMO teto de arquivos de um ZIP: um EML com
      // 2.000 imagens disparava 2.000 OCR e visão na nuvem (I6). Passou do teto, os que
      // sobram são listados, não abertos: o corpo e os primeiros anexos continuam lidos.
      const filhoDoEmail = (b: Buffer, n: string): Promise<Extraido> => {
        if (orcamento.arquivos <= 0) return Promise.resolve(naoAberto(b, n, `não aberto: o e-mail passa do teto de ${limites.zipMaxArquivos} arquivos (Ajustes, Anexos)`));
        orcamento.arquivos--;
        return filho(b, n, profundidade + 1);
      };
      const e: EmailLido = tipo.ext === "msg"
        // o MSG traz o e-mail de dentro já lido, sem passar pelo extrator: a profundidade é contada lá
        ? await lerMsg(buf, filhoDoEmail, { niveis: Math.max(0, limites.zipProfundidade - profundidade), podeAbrir: () => (orcamento.arquivos > 0 ? (orcamento.arquivos--, true) : false) })
        : await lerEml(buf, filhoDoEmail);
      const comoArquivo = emailComoExtraido(e, ex.nome);
      return lido(ex, { texto: textoDoEmail(e), resumo: comoArquivo.resumo }, {
        estruturado: comoArquivo.estruturado,
        arquivos: e.anexos.map((a) => ({ caminho: a.nome, ext: a.tipo.ext, familia: a.tipo.familia, tamanho: a.tamanho, lido: a.lido, resumo: a.resumo })),
        ...(e.anexos.find((a) => a.senhaUsada !== undefined) ? { senhaUsada: e.anexos.find((a) => a.senhaUsada !== undefined)!.senhaUsada } : {}),
      }, juntando);
    }

    case "compactado": {
      if (profundidade > limites.zipProfundidade) return naoLido(ex, `Compactado dentro de compactado além de ${limites.zipProfundidade} nível(is): listado, não aberto.`);
      const s = sete(limites, opts);
      if (tipo.ext === "gz") {
        if (buf.length > 0 && orcamento.bytes <= 0) throw new CompactadoRecusadoError("O conteúdo descompactado passa do teto.");
        // o arquivo de dentro do GZIP conta no teto de arquivos, como o de um ZIP (M5)
        orcamento.arquivos--;
        if (orcamento.arquivos < 0) throw new CompactadoRecusadoError(`Os compactados, somados, passam de ${limites.zipMaxArquivos} arquivos. Não abri.`);
        let interno: Buffer;
        try {
          interno = gunzipSync(buf, { maxOutputLength: Math.max(1, Math.min(limites.arquivoMaxBytes, orcamento.bytes)) });
        } catch (e) {
          if (e instanceof RangeError || /maxOutputLength|larger than/i.test(String((e as Error)?.message))) throw new CompactadoRecusadoError("O conteúdo descompactado passa do teto. Pode ser uma bomba de compressão: não abri.");
          throw e;
        }
        orcamento.bytes -= interno.length;
        const r = await filho(interno, ex.nome.replace(/\.t?gz$/i, (m) => (m.toLowerCase() === ".tgz" ? ".tar" : "")), profundidade + 1);
        return lido(ex, { texto: r.lido ? r.texto : r.resumo, partes: r.partes, resumo: `GZIP com ${r.nome}: ${r.resumo}`, tabelas: r.tabelas, avisos: r.avisos }, { arquivos: [{ caminho: r.nome, ext: r.tipo.ext, familia: r.tipo.familia, tamanho: r.tamanho, lido: r.lido, resumo: r.resumo }] }, juntando);
      }
      const r = tipo.ext === "zip" ? await lerZip(buf, limites, orcamento, profundidade, senhas, filho, s, opts.semRemetente)
        : s ? await lerCom7Zip(buf, tipo.ext, limites, orcamento, profundidade, senhas, filho, s, opts.semRemetente)
        : null;
      if (!r) return naoLido(ex, `Compactado ${tipo.ext.toUpperCase()} de ${tam}. Para abrir este formato a Órbita precisa do 7-Zip instalado (Ajustes, Anexos, "Caminho do 7-Zip").`);
      if (r.protegido) return naoLido(ex, r.protegido.motivo, { protegido: r.protegido, arquivos: r.arquivos });
      return lido(ex, { texto: r.texto, partes: r.partes, resumo: r.resumo, avisos: r.avisos }, { arquivos: r.arquivos, ...(r.senhaUsada !== undefined ? { senhaUsada: r.senhaUsada } : {}) }, juntando);
    }

    case "audio": {
      const r = await lerAudio(buf, tipo.mime, ex.nome, { userId: opts.userId, transcrever: limites.transcreverAudio, progresso: opts.progresso, deps: opts.midia });
      return r.lido ? lido(ex, { texto: r.texto, resumo: r.resumo, avisos: r.avisos }, {}, folha) : naoLido(ex, r.resumo);
    }

    case "video": {
      const r = await lerVideo(buf, tipo.mime, ex.nome, { userId: opts.userId, transcrever: limites.transcreverAudio, quadros: limites.quadrosDoVideo, progresso: opts.progresso, deps: opts.midia });
      return r.lido ? lido(ex, { texto: r.texto, resumo: r.resumo, avisos: r.avisos }, {}, folha) : naoLido(ex, r.resumo, { avisos: [...ex.avisos, ...r.avisos] });
    }

    case "agenda": {
      const t = decodificar(buf);
      const eventos = t ? lerIcs(t.texto) : [];
      if (!eventos.length) return naoLido(ex, "Arquivo de agenda (ICS) sem nenhum evento.");
      return lido(ex, { texto: textoDosEventos(eventos), resumo: `Convite de agenda com ${eventos.length} evento(s): ${eventos.map((e) => e.titulo).join(", ")}. Para pôr na agenda, use criar_evento (passa pela sua aprovação).` }, { estruturado: { tipo: "agenda", eventos } }, folha);
    }

    case "contato": {
      const t = decodificar(buf);
      const contatos = t ? lerVcf(t.texto) : [];
      if (!contatos.length) return naoLido(ex, "Cartão de contato (VCF) vazio.");
      return lido(ex, { texto: textoDosContatos(contatos), resumo: `Cartão com ${contatos.length} contato(s): ${contatos.map((c) => c.nome).join(", ")}.` }, { estruturado: { tipo: "contato", contatos } }, folha);
    }

    case "nota_fiscal": {
      const t = decodificar(buf);
      if (!t) return naoLido(ex, "XML de nota fiscal ilegível.");
      const nota = lerNfe(t.texto);
      const valor = nota.valorTotal !== null ? `R$ ${nota.valorTotal.toFixed(2).replace(".", ",")}` : "valor não identificado";
      return lido(ex, { texto: textoDaNota(nota), resumo: `Nota fiscal eletrônica de ${nota.emitente ?? "emitente não identificado"}, ${valor}${nota.data ? `, em ${nota.data}` : ""}, ${nota.itens.length} item(ns).` }, { estruturado: { tipo: "nota_fiscal", nota } }, folha);
    }

    case "executavel": {
      const aviso = "Executável ou instalador: a Órbita nunca executa, nunca abre e nunca grava este arquivo com permissão de execução.";
      return naoLido(ex, `Executável ou instalador (${tipo.ext.toUpperCase()}), ${tam}, SHA-256 ${ex.sha256}. ${aviso}`, { avisos: [...ex.avisos, aviso] });
    }

    default:
      return naoLido(ex, `Tipo ${tipo.ext.toUpperCase()} (${tipo.mime}), ${tam}: não sei ler este formato.`);
  }
}
