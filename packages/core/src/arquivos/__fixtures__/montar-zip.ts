import { crc32, deflateRawSync } from "node:zlib";

/**
 * Um ZIP montado no próprio teste (deflate, sem biblioteca), para os casos que
 * não cabem num arquivo de exemplo: centenas de entradas, `__MACOSX`, texto que
 * comprime mil vezes. Só para teste.
 */
export function montarZip(arquivos: Record<string, string | Buffer>): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let pos = 0;
  const nomes = Object.keys(arquivos);
  for (const nome of nomes) {
    const conteudo = arquivos[nome]!;
    const dados = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, "utf8");
    const pasta = nome.endsWith("/");
    const comp = pasta ? Buffer.alloc(0) : deflateRawSync(dados);
    const metodo = pasta ? 0 : 8;
    const n = Buffer.from(nome, "utf8");
    const crc = pasta ? 0 : crc32(dados) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(pasta ? 0 : dados.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(pasta ? 0 : dados.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(pos, 42);
    locais.push(local, n, comp);
    centrais.push(central, n);
    pos += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(nomes.length, 8); fim.writeUInt16LE(nomes.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...locais, cd, fim]);
}

function crcByte(crc: number, b: number): number {
  let c = (crc ^ b) & 0xff;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return (c ^ (crc >>> 8)) >>> 0;
}

/**
 * Um ZIP de UMA entrada com ZipCrypto (a senha "tradicional"), com o tamanho
 * declarado à escolha do teste: é o caso do cabeçalho que mente, que o yauzl
 * não confere quando o conteúdo é cifrado. Só para teste.
 */
export function montarZipComSenha(nome: string, conteudo: Buffer, senha: string, tamanhoDeclarado = conteudo.length): Buffer {
  const comprimido = deflateRawSync(conteudo);
  const crc = crc32(conteudo) >>> 0;
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;
  const atualizar = (b: number) => {
    k0 = crcByte(k0, b);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = crcByte(k2, k1 >>> 24);
  };
  for (const b of Buffer.from(senha, "utf8")) atualizar(b);
  const claro = Buffer.concat([Buffer.alloc(11, 7), Buffer.from([crc >>> 24]), comprimido]);
  const cifrado = Buffer.alloc(claro.length);
  for (let i = 0; i < claro.length; i++) {
    const t = (k2 | 2) & 0xffff;
    cifrado[i] = claro[i]! ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
    atualizar(claro[i]!);
  }
  const n = Buffer.from(nome, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0801, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(cifrado.length, 18); local.writeUInt32LE(tamanhoDeclarado, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0801, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(cifrado.length, 20); central.writeUInt32LE(tamanhoDeclarado, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const cd = Buffer.concat([central, n]);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(30 + n.length + cifrado.length, 16);
  return Buffer.concat([local, n, cifrado, cd, fim]);
}
