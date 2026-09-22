import { settings } from "@orbita/core/settings/index";
import type { RouteCtx } from "../http/web";
import { leituraCacheavel } from "../http/cacheable";
import { sessionOf } from "../http/web-route";

/**
 * O que o NAVEGADOR precisa saber para ser uma câmera: de quanto em quanto
 * tempo mandar um quadro, com que largura e com que compressão.
 *
 * Mesma razão da rota de limites da identidade: se o front repetir esses
 * números, mudar a config na tela não muda nada e ninguém entende por quê.
 */
export async function GET(req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const cfg = await settings.getMany(["cameras.deviceIntervalSeconds", "cameras.deviceMaxWidth", "cameras.deviceQuality", "cameras.snapshotMaxKB", "cameras.capturaAoFalarMs"]);
  return leituraCacheavel(req, {
    intervaloSegundos: cfg["cameras.deviceIntervalSeconds"],
    larguraMaxima: cfg["cameras.deviceMaxWidth"],
    qualidade: cfg["cameras.deviceQuality"],
    quadroMaxKB: cfg["cameras.snapshotMaxKB"],
    esperaAoFalarMs: cfg["cameras.capturaAoFalarMs"],
  });
}
