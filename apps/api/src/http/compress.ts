import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

export type Codificacao = "br" | "gzip";

/**
 * COMPRESSÃO SÓ DE JSON COMPLETO, e de propósito.
 *
 * O caminho do chat responde NDJSON token a token: qualquer compressor que
 * acumule para comprimir melhor seguraria o primeiro token e destruiria o que
 * o streaming existe para dar. Áudio do TTS e upload já vêm comprimidos, e
 * comprimir de novo é só CPU.
 *
 * Por isso a decisão não é "comprimir tudo menos X" (lista que envelhece mal e
 * silenciosamente), e sim "comprimir só o que se sabe ser um documento inteiro
 * e repetitivo": `application/json`. A lista de entidades do Home Assistant
 * tem dezenas de kB de chaves repetidas e cai para uma fração disso.
 */
export function deveComprimir(opts: {
  metodo: string;
  status: number;
  contentType: string | null;
  contentEncoding: string | null;
  tamanhoBytes: number;
  minimoBytes: number;
}): boolean {
  if (opts.metodo === "HEAD") return false;
  // 204/304 não têm corpo; comprimir um corpo vazio só acrescenta cabeçalho.
  if (opts.status === 204 || opts.status === 304) return false;
  if (opts.contentEncoding) return false; // já veio comprimido de algum lugar
  if (!opts.contentType?.toLowerCase().startsWith("application/json")) return false;
  // Abaixo do mínimo o cabeçalho e a CPU custam mais do que os bytes poupados.
  return opts.tamanhoBytes >= opts.minimoBytes;
}

/**
 * Qual codificação usar, pelo `Accept-Encoding` do cliente.
 *
 * Brotli primeiro porque comprime JSON bem melhor que gzip; na qualidade 4 o
 * custo de CPU é próximo. `identity` e `*;q=0` significam "não comprima".
 */
export function codificacaoAceita(accept: string | null | undefined): Codificacao | null {
  if (!accept) return null;
  const itens = accept.toLowerCase().split(",").map((p) => {
    const [nome, ...params] = p.trim().split(";");
    const q = params.map((s) => s.trim()).find((s) => s.startsWith("q="));
    return { nome: (nome ?? "").trim(), q: q ? Number(q.slice(2)) : 1 };
  });
  const aceita = (n: string) => itens.some((i) => (i.nome === n || i.nome === "*") && i.q > 0);
  if (aceita("br")) return "br";
  if (aceita("gzip")) return "gzip";
  return null;
}

/** Comprime o corpo. Brotli em qualidade 4: quase o ganho do 11 por uma fração da CPU. */
export async function comprimir(corpo: Buffer, como: Codificacao): Promise<Buffer> {
  if (como === "br") {
    return brotli(corpo, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 4,
        [constants.BROTLI_PARAM_SIZE_HINT]: corpo.byteLength,
      },
    });
  }
  return gzipAsync(corpo, { level: 6 });
}

/**
 * Tamanho mínimo para valer a pena comprimir (`cache.comprimirAcimaDeBytes`).
 *
 * O import é TARDIO de propósito: `web.ts` é a ponte Express ⇄ Web API, pura
 * encanação, e é importado por testes que não têm banco nenhum. Puxar o
 * módulo de config (e, por tabela, o cliente do Postgres) no topo obrigaria
 * qualquer um desses testes a ter `DATABASE_URL`. O módulo fica em cache
 * depois da primeira resposta, então isto não é uma ida ao disco por request.
 */
export async function minimoParaComprimir(): Promise<number> {
  try {
    const { settings } = await import("@orbita/core/settings/index");
    return await settings.get("cache.comprimirAcimaDeBytes");
  } catch {
    return 1024; // banco fora do ar não pode impedir uma resposta de sair
  }
}

/**
 * Acrescenta um campo ao `Vary` sem apagar o que já estava lá.
 *
 * `leituraCacheavel` já manda `Vary: Cookie` (a resposta é do dono). Trocar o
 * cabeçalho por `Accept-Encoding` faria um cache intermediário achar que a
 * resposta serve para qualquer pessoa, que é justamente o que não pode.
 */
export function acrescentarVary(res: ExpressResponse, campo: string): void {
  const atual = res.getHeader("Vary");
  const lista = String(atual ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (lista.some((v) => v.toLowerCase() === campo.toLowerCase())) return;
  res.setHeader("Vary", [...lista, campo].join(", "));
}

/**
 * O MESMO tratamento para os controllers do Nest.
 *
 * As rotas migradas em paridade passam pela ponte (`sendWebResponse`), que já
 * comprime. Os seis controllers que não passam por ela (ajustes, ferramentas,
 * regras, eventos, dono, saúde) respondem pelo `res.json` do Express, e um
 * deles sozinho, a listagem de Ajustes, são 60 kB de JSON repetitivo.
 *
 * Trocar `res.json` é invasivo, e é por isso que o alcance é estreito de
 * propósito: só o corpo JSON completo que o Express já ia serializar de uma
 * vez. Nada que transmita em partes usa `res.json`, então o NDJSON do chat e o
 * áudio do TTS não passam nem perto daqui.
 */
export function compressaoDeControllers(req: ExpressRequest, res: ExpressResponse, next: () => void): void {
  const jsonOriginal = res.json.bind(res);

  res.json = ((corpo: unknown) => {
    if (res.headersSent) return jsonOriginal(corpo);

    void (async () => {
      try {
        const buf = Buffer.from(JSON.stringify(corpo ?? null));
        const codificacao = codificacaoAceita(req.headers["accept-encoding"]);
        const minimoBytes = await minimoParaComprimir();
        res.setHeader("Content-Type", "application/json; charset=utf-8");

        const comprime =
          !!codificacao &&
          minimoBytes > 0 &&
          deveComprimir({
            metodo: req.method,
            status: res.statusCode,
            contentType: "application/json",
            contentEncoding: (res.getHeader("Content-Encoding") as string | undefined) ?? null,
            tamanhoBytes: buf.byteLength,
            minimoBytes,
          });

        if (comprime) {
          const pacote = await comprimir(buf, codificacao!);
          res.setHeader("Content-Encoding", codificacao!);
          res.setHeader("Content-Length", pacote.byteLength);
          acrescentarVary(res, "Accept-Encoding");
          res.end(pacote);
          return;
        }
        res.setHeader("Content-Length", buf.byteLength);
        res.end(buf);
      } catch {
        // qualquer imprevisto: responde do jeito de sempre, sem comprimir
        if (!res.headersSent) jsonOriginal(corpo);
        else res.end();
      }
    })();

    return res;
  }) as typeof res.json;

  next();
}
