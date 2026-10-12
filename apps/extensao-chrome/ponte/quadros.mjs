// Native messaging (B7): cada mensagem é JSON em UTF-8 com o tamanho na frente,
// 32 bits na ordem nativa (little-endian no Windows). O Chrome aceita no máximo
// 1 MB por mensagem do host para ele: o que passar disso vai em pedaços, e a
// extensão junta (`juntarPedaco` no service worker).

export const LIMITE_DO_HOST = 1024 * 1024;
/** folga para o envelope `{"t":"pedaco",...}` e o escape do JSON */
export const TAMANHO_DO_PEDACO = 700 * 1024;

export function quadro(obj) {
  const corpo = Buffer.from(JSON.stringify(obj), "utf8");
  const cab = Buffer.alloc(4);
  cab.writeUInt32LE(corpo.length, 0);
  return Buffer.concat([cab, corpo]);
}

/** Quadros prontos para o Chrome: um só, ou pedaços quando passa do limite. */
export function quadrosParaOChrome(obj, id) {
  const texto = JSON.stringify(obj);
  if (Buffer.byteLength(texto, "utf8") + 4 <= LIMITE_DO_HOST) return [quadro(obj)];
  const partes = [];
  for (let i = 0; i < texto.length; i += TAMANHO_DO_PEDACO) partes.push(texto.slice(i, i + TAMANHO_DO_PEDACO));
  return partes.map((dados, i) => quadro({ t: "pedaco", id, i, n: partes.length, dados }));
}

/** Leitor incremental: recebe bytes do stdin e devolve as mensagens inteiras. */
export function criarLeitor(aoMensagem, limite = 64 * 1024 * 1024) {
  let acumulado = Buffer.alloc(0);
  return (pedaco) => {
    acumulado = Buffer.concat([acumulado, pedaco]);
    while (acumulado.length >= 4) {
      const n = acumulado.readUInt32LE(0);
      if (n > limite) throw new Error(`mensagem de ${n} bytes passa do limite`);
      if (acumulado.length < 4 + n) break;
      const corpo = acumulado.subarray(4, 4 + n).toString("utf8");
      acumulado = acumulado.subarray(4 + n);
      aoMensagem(JSON.parse(corpo));
    }
  };
}
