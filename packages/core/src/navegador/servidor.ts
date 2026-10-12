import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { aoConectar } from "./canal";
import { MAX_MENSAGEM_BYTES } from "./protocolo";
import { segredoConfere, segredoDaPonte } from "./ponte";
import { log } from "../observability/logger";

/**
 * O CANAL DA EXTENSÃO no servidor HTTP do processo vivo (PRD §5.2, B1):
 * `ws://127.0.0.1:3010/api/navegador/canal`.
 *
 * Esta camada só faz o transporte e as recusas que nem precisam abrir o
 * WebSocket (a decisão de quem é quem mora em `core/navegador/canal.ts`):
 *   - caminho errado ou com consulta na URL (o token NUNCA vai na URL);
 *   - conexão que não veio da própria máquina;
 *   - `Origin` de página web (só `chrome-extension://` passa daqui; o ID
 *     exato é conferido no core, com o token). Página nenhuma consegue mentir
 *     o `Origin`: é o que fecha o ataque do CVE-2026-25253 (OpenClaw);
 *   - sem `Origin`, só a ponte de native messaging, que prova quem é com o
 *     SEGREDO do arquivo que o instalador dela gerou (`navegador/ponte.ts`) e,
 *     como qualquer um, ainda precisa do token;
 *   - conexão que passou por um proxy (I-2 da auditoria): o rewrite do Next
 *     mandava `/api/navegador/canal` ao api, e o api via o socket do PRÓPRIO
 *     Next (127.0.0.1). Com `next dev -H 0.0.0.0`, uma máquina da rede chegava
 *     ao canal assim. Cabeçalho de encaminhamento (`x-forwarded-*`,
 *     `forwarded`, `x-real-ip`) ou `Host` que não seja o desta porta nesta
 *     máquina é recusado. A extensão fala direto com a 3010.
 * Sem CORS e sem resposta útil para quem é recusado.
 */

export const CAMINHO_DO_CANAL = "/api/navegador/canal";

const LOCAL = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function recusar(socket: Duplex, status: number, motivo: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${motivo}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}

/** Cabeçalhos que um proxy põe: a conexão não veio direto da extensão nem da ponte. */
const ENCAMINHADO = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "forwarded", "x-real-ip", "via"];

/** O `Host` é esta porta nesta máquina? (127.0.0.1, localhost ou [::1]) */
function hostLocal(host: unknown, porta: number | null | undefined): boolean {
  if (typeof host !== "string" || !porta) return false;
  const h = host.trim().toLowerCase();
  return h === `127.0.0.1:${porta}` || h === `localhost:${porta}` || h === `[::1]:${porta}`;
}

/** A conexão pode subir para WebSocket? Devolve a recusa (status) ou o que o core precisa saber. Puro (o segredo da ponte vem por parâmetro). */
export function triagemDoUpgrade(
  req: Pick<IncomingMessage, "url" | "headers"> & { remoto?: string | null; portaLocal?: number | null },
  segredo: string | null = segredoDaPonte(),
):
  | { ok: true; origin: string | null; ponte: boolean; origemDaPonte?: string | null }
  | { ok: false; status: number; motivo: string } {
  const bruto = req.url ?? "";
  const [caminho, consulta] = bruto.split("?");
  if (caminho !== CAMINHO_DO_CANAL) return { ok: false, status: 404, motivo: "Not Found" };
  if (consulta !== undefined) return { ok: false, status: 400, motivo: "Bad Request" };
  if (!req.remoto || !LOCAL.has(req.remoto)) return { ok: false, status: 403, motivo: "Forbidden" };
  if (ENCAMINHADO.some((h) => req.headers[h] !== undefined)) return { ok: false, status: 403, motivo: "Forbidden" };
  if (!hostLocal(req.headers.host, req.portaLocal)) return { ok: false, status: 403, motivo: "Forbidden" };
  const o = req.headers.origin;
  const origin = typeof o === "string" && o ? o : null;
  if (origin) return /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? { ok: true, origin, ponte: false } : { ok: false, status: 403, motivo: "Forbidden" };
  // sem Origin, só a ponte, e só com o segredo do arquivo (nunca mais um "1" que qualquer processo manda)
  const p = req.headers["x-orbita-ponte"];
  if (!segredoConfere(typeof p === "string" ? p : null, segredo)) return { ok: false, status: 403, motivo: "Forbidden" };
  const op = req.headers["x-orbita-ponte-origem"];
  const origemDaPonte = typeof op === "string" && /^chrome-extension:\/\/[a-p]{32}\/?$/.test(op) ? op.replace(/\/$/, "") : null;
  return { ok: true, origin: null, ponte: true, origemDaPonte };
}

/** Pendura o canal no servidor HTTP do Nest. Devolve a função que o desliga. */
export function anexarCanalDoNavegador(server: Server): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MENSAGEM_BYTES, perMessageDeflate: false });

  const aoUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const t = triagemDoUpgrade({ url: req.url, headers: req.headers, remoto: req.socket.remoteAddress ?? null, portaLocal: req.socket.localPort ?? null });
    if (!t.ok) {
      if (t.status !== 404) log.warn("navegador.canal_recusado", { status: t.status, origin: typeof req.headers.origin === "string" ? req.headers.origin.slice(0, 80) : null });
      return recusar(socket, t.status, t.motivo);
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const h = aoConectar(
        {
          enviar: (m) => {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
          },
          fechar: (codigo, motivo) => ws.close(codigo, motivo),
        },
        { origin: t.origin, ponte: t.ponte, origemDaPonte: t.origemDaPonte ?? null },
      );
      ws.on("message", (dados, binario) => {
        if (binario) return ws.close(1003, "só texto");
        void h.receber(dados.toString()).catch((e) => log.warn("navegador.mensagem_falhou", { erro: e instanceof Error ? e.message : String(e) }));
      });
      ws.on("close", () => h.fechou());
      ws.on("error", (e) => log.warn("navegador.socket_erro", { erro: e.message }));
    });
  };

  server.on("upgrade", aoUpgrade);
  return () => {
    server.off("upgrade", aoUpgrade);
    for (const c of wss.clients) c.close(1001, "api desligando");
    wss.close();
  };
}
