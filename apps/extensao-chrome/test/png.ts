import { inflateSync } from "node:zlib";

/**
 * Lê um PNG (8 bits, RGB ou RGBA, sem entrelaçamento: o que o Chrome devolve no
 * `Page.captureScreenshot`) em pixels, para os testes conferirem a MÁSCARA de
 * verdade, e não só o tamanho da imagem. Sem dependência: zlib do Node.
 */
export interface Pixels {
  largura: number;
  altura: number;
  canais: number;
  dados: Uint8Array;
}

export function lerPng(buf: Buffer): Pixels {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("não é PNG");
  let p = 8;
  let largura = 0;
  let altura = 0;
  let tipo = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const nome = buf.toString("ascii", p + 4, p + 8);
    const dados = buf.subarray(p + 8, p + 8 + len);
    if (nome === "IHDR") {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      if (dados[8] !== 8 || dados[12] !== 0) throw new Error("só PNG de 8 bits sem entrelaçamento");
      tipo = dados[9]!;
    } else if (nome === "IDAT") idat.push(dados);
    else if (nome === "IEND") break;
    p += 12 + len;
  }
  const canais = tipo === 6 ? 4 : tipo === 2 ? 3 : 0;
  if (!canais) throw new Error(`tipo de cor ${tipo} não suportado`);
  const cru = inflateSync(Buffer.concat(idat));
  const linha = largura * canais;
  const out = new Uint8Array(linha * altura);
  for (let y = 0; y < altura; y++) {
    const filtro = cru[y * (linha + 1)]!;
    const src = y * (linha + 1) + 1;
    for (let x = 0; x < linha; x++) {
      const a = x >= canais ? out[y * linha + x - canais]! : 0;
      const b = y > 0 ? out[(y - 1) * linha + x]! : 0;
      const c = y > 0 && x >= canais ? out[(y - 1) * linha + x - canais]! : 0;
      const v = cru[src + x]!;
      let r: number;
      if (filtro === 0) r = v;
      else if (filtro === 1) r = v + a;
      else if (filtro === 2) r = v + b;
      else if (filtro === 3) r = v + ((a + b) >> 1);
      else {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * linha + x] = r & 0xff;
    }
  }
  return { largura, altura, canais, dados: out };
}

/** Quantos pixels da região são "escuros" (soma RGB abaixo do limiar): é onde há glifo de texto preto. */
export function pixelsEscuros(img: Pixels, regiao: { x: number; y: number; w: number; h: number }, limiar = 200): number {
  let n = 0;
  for (let y = Math.max(0, regiao.y); y < Math.min(img.altura, regiao.y + regiao.h); y++) {
    for (let x = Math.max(0, regiao.x); x < Math.min(img.largura, regiao.x + regiao.w); x++) {
      const i = (y * img.largura + x) * img.canais;
      if (img.dados[i]! + img.dados[i + 1]! + img.dados[i + 2]! < limiar) n++;
    }
  }
  return n;
}
