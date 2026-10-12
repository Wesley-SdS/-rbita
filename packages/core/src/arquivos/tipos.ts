/**
 * O vocabulário do extrator universal (PRD-COMPUTADOR-E-NAVEGADOR §8.1, C3).
 *
 * Um arquivo, venha de onde vier (anexo de e-mail, WhatsApp, Telegram,
 * "indexar arquivo"), vira um `Extraido`: o tipo decidido pelos BYTES, o texto
 * que dá para ler, as partes (página, aba, slide, arquivo de dentro do ZIP) e
 * um resumo de uma frase. Quando não dá para ler, `lido` é falso e o resumo diz
 * por quê. Bytes crus nunca chegam ao modelo.
 */

export type Familia =
  | "pdf"
  | "imagem"
  | "texto"
  | "tabela"
  | "html"
  | "documento"
  | "planilha"
  | "apresentacao"
  | "email"
  | "compactado"
  | "audio"
  | "video"
  | "agenda"
  | "contato"
  | "nota_fiscal"
  | "script"
  | "executavel"
  | "protegido"
  | "desconhecido";

export interface TipoDetectado {
  /** extensão canônica do que os bytes são: "docx", "pdf", "csv"… */
  ext: string;
  mime: string;
  familia: Familia;
  /** o nome ou o Content-Type que o remetente escolheu dizia outra coisa */
  divergente?: boolean;
  /** o que o remetente disse, para o aviso ("o nome dizia .pdf") */
  declarado?: string;
}

export interface EventoLido {
  titulo: string;
  inicio: string | null;
  fim: string | null;
  diaInteiro: boolean;
  local: string | null;
  descricao: string | null;
  organizador: string | null;
  participantes: string[];
}

export interface ContatoLido {
  nome: string;
  telefones: string[];
  emails: string[];
  empresa: string | null;
  aniversario: string | null;
  endereco: string | null;
}

export interface ItemDaNota {
  descricao: string;
  quantidade: number | null;
  unidade: string | null;
  valorUnitario: number | null;
  valorTotal: number | null;
}

export interface NotaFiscalLida {
  emitente: string | null;
  nomeFantasia: string | null;
  cnpj: string | null;
  numero: string | null;
  serie: string | null;
  /** YYYY-MM-DD */
  data: string | null;
  /** em reais, como vem no XML */
  valorTotal: number | null;
  chave: string | null;
  itens: ItemDaNota[];
}

export interface CabecalhoDeEmail {
  de: string | null;
  para: string[];
  cc: string[];
  data: string | null;
  assunto: string | null;
}

export type Estruturado =
  | { tipo: "agenda"; eventos: EventoLido[] }
  | { tipo: "contato"; contatos: ContatoLido[] }
  | { tipo: "nota_fiscal"; nota: NotaFiscalLida }
  | { tipo: "email"; cabecalho: CabecalhoDeEmail };

/** Um arquivo de dentro de um compactado ou de um e-mail anexado. */
export interface ArquivoInterno {
  caminho: string;
  ext: string;
  familia: Familia;
  tamanho: number;
  lido: boolean;
  resumo: string;
}

export interface Extraido {
  nome: string;
  tipo: TipoDetectado;
  tamanho: number;
  /** SHA-256 dos bytes: o mesmo arquivo lido de novo não paga a leitura outra vez */
  sha256: string;
  lido: boolean;
  /** tudo que foi lido, em texto com tabelas em Markdown */
  texto: string;
  /** página, aba, slide ou arquivo interno: é o que a indexação grava como "veio da parte N" */
  partes: string[];
  resumo: string;
  tabelas: number;
  avisos: string[];
  /** ficou fechado: nenhuma senha cadastrada abriu */
  protegido?: { motivo: string };
  /**
   * Qual das `senhas` abriu (a POSIÇÃO na lista, nunca a senha): é só ela que
   * ganha o "usada em" na tela. Antes todas as do domínio eram marcadas (M17).
   */
  senhaUsada?: number;
  estruturado?: Estruturado;
  arquivos?: ArquivoInterno[];
  /** PDF e imagem: o detalhe por página do pipeline do R5, para o `lerDocumento` devolver como sempre */
  documento?: { paginas: PaginaDoDocumento[]; resumo: { nativas: number; ocr: number; visao: number; vazias: number; confiancaMedia: number | null } };
}

/** O mesmo `PaginaLida` do `ocr/index.ts`, repetido aqui para o vocabulário não importar o OCR. */
export interface PaginaDoDocumento {
  numero: number;
  texto: string;
  origem: "pdf" | "ocr" | "visao" | "texto" | "imagem";
  confianca: number | null;
  tabelas: number;
  aviso?: string;
}

export type Progresso = (feito: number, total: number | null, passo: string) => Promise<void>;

/** Os tetos de engenharia, todos vindos da config (§5.6). */
export interface Limites {
  linhasMax: number;
  zipMaxArquivos: number;
  zipMaxBytes: number;
  zipProfundidade: number;
  /** teto de cada arquivo lido (o de anexo vale também para o que sai de um ZIP) */
  arquivoMaxBytes: number;
  transcreverAudio: boolean;
  quadrosDoVideo: number;
  seteZip: string;
  /**
   * Teto de TEXTO extraído, somado em todos os níveis (`anexos.textoMaxCaracteres`).
   * O orçamento de bytes não bastava: um ZIP de 500 KB com TXT repetido sai como
   * uma string de 500 MB, clonada da thread, partida e gravada inteira (I5).
   */
  textoMax: number;
}

/**
 * Bytes descompactados e arquivos já abertos, somados em todos os níveis.
 *
 * Compartilhado de propósito entre o ZIP de fora e os de dentro: uma bomba
 * que esconde a explosão no terceiro nível gasta do mesmo orçamento que o
 * primeiro, e para no mesmo teto.
 */
export interface Orcamento {
  bytes: number;
  arquivos: number;
  /** caracteres de texto que ainda cabem (ver `Limites.textoMax`); sem o campo, sem teto */
  texto?: number;
}

export interface OpcoesDeExtracao {
  nome?: string;
  /** o Content-Type que veio junto: só serve de pista e para o aviso de divergência */
  mimeDeclarado?: string | null;
  /** dono da leitura, para a visão e a transcrição contarem na conta dele */
  userId?: string;
  /** senhas a tentar em arquivo protegido (as do remetente, cadastradas na tela) */
  senhas?: readonly string[];
  /**
   * O arquivo não veio de um e-mail (WhatsApp, Telegram, indexar arquivo): não há
   * remetente cuja senha tentar, e a mensagem de "tem senha" não manda cadastrar
   * uma senha que nunca seria usada (I16).
   */
  semRemetente?: boolean;
  /**
   * Tabela e planilha voltam CRUAS, em CSV, sem o corte de `anexos.linhasMax`:
   * é o caminho do extrato, que o leitor determinístico (`finance/extrato.ts`)
   * lê linha a linha. A tabela Markdown cortada em 2.000 linhas perdia
   * lançamento sem aviso (I7, I8).
   */
  comoCsv?: boolean;
  progresso?: Progresso;
  /** parar no próximo ponto seguro (a resposta não pode mais esperar) */
  sinal?: AbortSignal;
  profundidade?: number;
  orcamento?: Orcamento;
  /** sobrescreve a config (testes e chamadas internas) */
  limites?: Partial<Limites>;
}

/** O compactado passou de um teto. Recusa o ARQUIVO inteiro, não só a parte. */
export class CompactadoRecusadoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompactadoRecusadoError";
  }
}

/** Quem pediu a leitura desistiu de esperar (ver `anexos.esperarSeg`). */
export class LeituraInterrompidaError extends Error {
  constructor() {
    super("Leitura interrompida.");
    this.name = "LeituraInterrompidaError";
  }
}

export function conferirSinal(sinal?: AbortSignal): void {
  if (sinal?.aborted) throw new LeituraInterrompidaError();
}

/**
 * A frase de "está com senha", a mesma para PDF, Office e compactado. PURO.
 *
 * Três casos: tentou as senhas do remetente e nenhuma abriu; o arquivo é de um
 * e-mail sem senha cadastrada (cadastrar resolve); ou o arquivo veio por outro
 * caminho, em que nenhuma senha cadastrada é tentada, e mandar cadastrar seria
 * prometer o que não acontece (I16 da auditoria).
 */
export function motivoDaSenha(oQue: string, senhas: readonly string[] | undefined, semRemetente?: boolean): string {
  if (senhas?.length) return `${oQue} tem senha, e nenhuma das senhas cadastradas para o remetente abriu. Confira em Ajustes, Anexos.`;
  if (semRemetente) return `${oQue} tem senha. A senha cadastrada em Ajustes, Anexos, só é tentada em anexo de e-mail (é pelo remetente que ela é escolhida): mande o arquivo sem senha, ou peça para eu ler o anexo direto do e-mail.`;
  return `${oQue} tem senha. Cadastre a senha do remetente em Ajustes, Anexos, e peça de novo.`;
}

/** O aviso de quando o texto parou no teto (`anexos.textoMaxCaracteres`), o mesmo em todos os níveis. */
export function avisoDoTetoDeTexto(teto: number): string {
  return `O texto passou do teto de ${teto.toLocaleString("pt-BR")} caracteres (Ajustes, Anexos, "Texto extraído no total"): li só o começo.`;
}
