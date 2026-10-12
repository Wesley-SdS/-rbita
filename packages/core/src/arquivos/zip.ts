import yauzl from "yauzl";
import { crc32, inflateRawSync } from "node:zlib";
import { CompactadoRecusadoError, type Orcamento } from "./tipos";
import { tamanhoLegivel } from "./texto";

/**
 * Abrir ZIP sem confiar no ZIP.
 *
 * Tudo em memória (nada é gravado em disco, então "zip slip" e permissão de
 * execução não existem aqui), e todo byte descompactado é CONTADO enquanto
 * sai: o tamanho declarado no cabeçalho é escolha de quem montou o arquivo, e
 * a bomba clássica declara 1 KB e entrega 4 GB. O `validateEntrySizes` do
 * yauzl corta quando o real passa do declarado; o orçamento corta quando a
 * soma passa do teto, em qualquer nível de ZIP dentro de ZIP.
 *
 * DOCX, XLSX, PPTX e ODF também são ZIP: passam por aqui antes de qualquer
 * biblioteca de Office inflá-los inteiros na memória.
 */

export interface EntradaZip {
  nome: string;
  tamanho: number;
  comprimido: number;
  pasta: boolean;
  criptografado: boolean;
  /** criptografia AES (método 99 do WinZip): só o 7-Zip abre */
  aes: boolean;
}

export interface ZipAberto {
  entradas: EntradaZip[];
  /**
   * Bytes de uma entrada, descontados do orçamento; senha só para entrada
   * criptografada (`aoAbrirCom` diz QUAL das senhas abriu, pela posição).
   */
  ler(nome: string, opts: { maxBytes: number; orcamento: Orcamento; senhas?: readonly string[]; aoAbrirCom?: (indice: number) => void }): Promise<Buffer>;
  fechar(): void;
}

export class SenhaDoZipError extends Error {
  constructor(public readonly aes: boolean) {
    super(aes ? "O ZIP tem criptografia AES." : "O ZIP tem senha.");
    this.name = "SenhaDoZipError";
  }
}

/**
 * UM arquivo de dentro passou do teto de arquivo (`anexos.tamanhoMaxMb`), com o
 * cabeçalho mentindo o tamanho, mas a soma do ZIP ainda cabe no orçamento. Não
 * é bomba: só ele fica de fora. Antes isso recusava o ZIP inteiro (M5).
 */
export class EntradaGrandeDemaisError extends Error {
  constructor() {
    super("Arquivo de dentro maior que o teto de arquivo.");
    this.name = "EntradaGrandeDemaisError";
  }
}

/**
 * O que é arquivo de verdade dentro de um compactado. A pasta, o `__MACOSX/`,
 * o `._nome` (a "AppleDouble" que o Mac grava ao lado de CADA arquivo), o
 * `.DS_Store` e o `Thumbs.db` não são lidos nem contam no teto de arquivos: um
 * ZIP feito no Mac com 120 arquivos tem mais de 240 entradas e era recusado
 * como bomba (M4). PURO.
 */
export function ehAlvoDeLeitura(nome: string): boolean {
  if (nome.endsWith("/")) return false;
  return !/(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$)/i.test(nome);
}

function abrirBuffer(bytes: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((ok, falha) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true, autoClose: false, validateEntrySizes: true, decodeStrings: true, strictFileNames: false }, (e, z) => (e || !z ? falha(e ?? new Error("ZIP inválido")) : ok(z))),
  );
}

export async function abrirZip(bytes: Buffer, maxArquivos: number): Promise<ZipAberto> {
  const z = await abrirBuffer(bytes);
  const brutas = new Map<string, yauzl.Entry>();
  const entradas: EntradaZip[] = [];
  // o teto é de ARQUIVOS (os que seriam lidos); pasta e lixo do Mac têm um teto próprio,
  // folgado, só para um diretório central de um milhão de pastas não encher a memória
  const maxEntradas = maxArquivos * 10 + 100;
  let arquivos = 0;
  try {
    await new Promise<void>((ok, falha) => {
      z.on("error", falha);
      z.on("end", () => ok());
      z.on("entry", (e: yauzl.Entry) => {
        if (ehAlvoDeLeitura(e.fileName)) arquivos++;
        if (arquivos > maxArquivos || entradas.length >= maxEntradas) {
          falha(new CompactadoRecusadoError(`O compactado tem mais de ${maxArquivos} arquivos (o teto configurado). Não abri.`));
          return;
        }
        const pasta = e.fileName.endsWith("/");
        entradas.push({ nome: e.fileName, tamanho: e.uncompressedSize, comprimido: e.compressedSize, pasta, criptografado: e.isEncrypted(), aes: e.compressionMethod === 99 });
        brutas.set(e.fileName, e);
        z.readEntry();
      });
      z.readEntry();
    });
  } catch (e) {
    z.close();
    throw e;
  }

  const ler = async (nome: string, opts: { maxBytes: number; orcamento: Orcamento; senhas?: readonly string[]; aoAbrirCom?: (indice: number) => void }): Promise<Buffer> => {
    const e = brutas.get(nome);
    if (!e) throw new Error(`Arquivo ${nome} não está no compactado.`);
    const restante = opts.orcamento.bytes;
    const teto = Math.min(opts.maxBytes, restante);
    if (e.uncompressedSize > restante) throw estourou(restante);
    // passou do teto do ARQUIVO com o orçamento ainda folgado: só ele fica de fora, e o que
    // já foi inflado conta no orçamento (inflar de novo e de novo também é custo)
    const passou = (): Error => {
      if (opts.maxBytes < restante) {
        opts.orcamento.bytes -= opts.maxBytes;
        return new EntradaGrandeDemaisError();
      }
      return estourou(restante);
    };
    if (e.isEncrypted()) {
      if (e.compressionMethod === 99) throw new SenhaDoZipError(true);
      const bruto = await lerStream(z, e, { decodeFileData: false }, e.compressedSize + 1);
      let aberto: { conteudo: Buffer; indice: number };
      try {
        aberto = decifrarZipCrypto(bruto, e, opts.senhas ?? [], teto);
      } catch (err) {
        if (err instanceof TetoDaEntradaError) throw passou();
        throw err;
      }
      opts.orcamento.bytes -= aberto.conteudo.length;
      if (opts.orcamento.bytes < 0) throw estourou(restante);
      opts.aoAbrirCom?.(aberto.indice);
      return aberto.conteudo;
    }
    const lidos = await lerStream(z, e, {}, teto).catch((err) => {
      // passou do teto contado: do arquivo (só ele sai) ou do orçamento (bomba)
      if (err instanceof TetoDaEntradaError) throw passou();
      // o real passou do DECLARADO: o cabeçalho mente, que é a marca da bomba montada.
      // Esse continua recusando o compactado inteiro, de propósito (bomba-mentirosa.zip)
      if (/too many bytes|bytes? in the stream/i.test(String(err?.message))) throw estourou(restante);
      throw err;
    });
    opts.orcamento.bytes -= lidos.length;
    return lidos;
  };

  return { entradas, ler, fechar: () => z.close() };
}

class TetoDaEntradaError extends Error {}

function estourou(restante: number): CompactadoRecusadoError {
  return new CompactadoRecusadoError(`O conteúdo descompactado passa do teto (sobravam ${tamanhoLegivel(Math.max(0, restante))}). Pode ser uma bomba de compressão: não abri.`);
}

function lerStream(z: yauzl.ZipFile, e: yauzl.Entry, opts: yauzl.ZipFileOptions, teto: number): Promise<Buffer> {
  return new Promise((ok, falha) => {
    z.openReadStream(e, opts, (err, stream) => {
      if (err || !stream) return falha(err ?? new Error("Não consegui ler a entrada do ZIP."));
      const partes: Buffer[] = [];
      let total = 0;
      stream.on("data", (c: Buffer) => {
        total += c.length;
        if (total > teto) {
          stream.destroy(new TetoDaEntradaError());
          return;
        }
        partes.push(c);
      });
      stream.on("error", falha);
      stream.on("end", () => ok(Buffer.concat(partes)));
    });
  });
}

/* --- ZipCrypto (a criptografia "tradicional" do PKWARE) ---------------------
 * É a que o Windows e a maioria dos programas gravam quando alguém põe senha
 * num ZIP. Fraca, mas é dela que vem o ZIP de senha do mundo real. AES fica
 * com o 7-Zip (`compactado.ts`).
 */

function crcByte(crc: number, b: number): number {
  let c = (crc ^ b) & 0xff;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return (c ^ (crc >>> 8)) >>> 0;
}

function decifrarComSenha(bruto: Buffer, senha: string): Buffer {
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;
  const atualizar = (b: number) => {
    k0 = crcByte(k0, b);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = crcByte(k2, k1 >>> 24);
  };
  for (const b of Buffer.from(senha, "utf8")) atualizar(b);
  const out = Buffer.alloc(bruto.length);
  for (let i = 0; i < bruto.length; i++) {
    const t = (k2 | 2) & 0xffff;
    const p = bruto[i]! ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
    out[i] = p;
    atualizar(p);
  }
  return out;
}

/**
 * Tenta cada senha. O 12º byte do cabeçalho confere a senha sem descompactar
 * (é o byte alto do CRC, ou da hora quando o bit 3 está ligado); o CRC do
 * conteúdo confere de novo no fim, porque aquele byte casa por acaso uma vez
 * em 256.
 */
function decifrarZipCrypto(bruto: Buffer, e: yauzl.Entry, senhas: readonly string[], teto: number): { conteudo: Buffer; indice: number } {
  const conferidor = (e.generalPurposeBitFlag & 0x8) !== 0 ? (e.lastModFileTime >>> 8) & 0xff : (e.crc32 >>> 24) & 0xff;
  for (const [indice, senha] of senhas.entries()) {
    const claro = decifrarComSenha(bruto.subarray(0, e.compressedSize), senha);
    if (claro.length < 12 || claro[11] !== conferidor) continue;
    const dados = claro.subarray(12);
    let conteudo: Buffer;
    try {
      conteudo = e.compressionMethod === 0 ? Buffer.from(dados) : inflateRawSync(dados, { maxOutputLength: Math.max(1, teto) });
    } catch (err) {
      // quem decide se é bomba ou só um arquivo grande é o `ler`, que conhece o orçamento
      if (err instanceof RangeError || /maxOutputLength|buffer/i.test(String((err as Error)?.message))) throw new TetoDaEntradaError();
      continue;
    }
    if (conteudo.length > teto) throw new TetoDaEntradaError();
    if ((crc32(conteudo) >>> 0) === (e.crc32 >>> 0)) return { conteudo, indice };
  }
  throw new SenhaDoZipError(false);
}
