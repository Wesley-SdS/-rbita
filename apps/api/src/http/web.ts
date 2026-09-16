import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { Readable } from "node:stream";

/**
 * Ponte Express ⇄ Web API (Request/Response do padrão fetch).
 *
 * As rotas migradas do Next já falavam Web API (`Response.json`, `req.json()`,
 * `req.formData()`, `req.signal`): a migração em PARIDADE mantém esse código
 * intacto e só troca a borda. Aqui convertemos o request do Express num
 * `Request` de verdade e despejamos o `Response` devolvido no `res` do Express,
 * fluindo o corpo chunk a chunk (o NDJSON do chat depende disso).
 */
export function toWebRequest(req: ExpressRequest, res?: ExpressResponse): Request {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const url = `${proto}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else headers.set(k, v);
  }

  // O AbortSignal segue a CONEXÃO DE RESPOSTA: com body-parser o `req` chega já
  // consumido (e o `close` dele já disparou); só o `close` do `res` diz que o
  // cliente foi embora antes do fim (barge-in do TTS, botão parar do chat).
  const ac = new AbortController();
  res?.once("close", () => {
    if (!res.writableFinished) ac.abort();
  });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = { method: req.method, headers, signal: ac.signal };
  if (hasBody) {
    if (req.readableEnded) {
      // o body-parser do Nest já consumiu o stream (JSON): reserializa
      init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    } else {
      // multipart e demais: o stream bruto segue para `req.formData()` da rota
      init.body = Readable.toWeb(req) as unknown as ReadableStream;
      init.duplex = "half";
    }
  }
  return new Request(url, init);
}

/** Despeja um `Response` Web no `res` do Express, fluindo o corpo. */
export async function sendWebResponse(_req: ExpressRequest, res: ExpressResponse, web: Response): Promise<void> {
  res.status(web.status);
  web.headers.forEach((v, k) => {
    if (k.toLowerCase() === "content-length") return; // recalculado pelo Node
    res.setHeader(k, v);
  });
  if (!web.body) {
    res.end();
    return;
  }
  res.flushHeaders();
  const reader = web.body.getReader();
  // se o cliente (ou o proxy) fechar a conexão, não podemos ficar esperando um
  // `drain` que nunca vem: soltamos o laço e cancelamos o corpo
  let closed = false;
  const onClose = () => {
    closed = true;
  };
  res.once("close", onClose);
  try {
    for (;;) {
      if (closed) {
        await reader.cancel().catch(() => {});
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise<void>((r) => {
          const done = () => r();
          res.once("drain", done);
          res.once("close", done);
        });
      }
    }
  } catch {
    // cliente foi embora no meio: nada a fazer
  } finally {
    res.off("close", onClose);
    res.end();
  }
}

/** Assinatura das rotas migradas (a mesma dos route handlers do Next, com a sessão já resolvida). */
export interface RouteCtx {
  params: Record<string, string>;
  user: { id: string; email: string; name: string } | null;
}
export type RouteHandler = (req: Request, ctx: RouteCtx) => Promise<Response> | Response;
