import { headers } from "next/headers";
import { settings } from "@orbita/core/settings/index";

/**
 * LER A API PELO SERVIDOR, para a tela já nascer com os dados.
 *
 * A tela mudava assim: o payload da rota chegava, o pedaço de JavaScript do
 * painel baixava, o painel montava e SÓ ENTÃO ele ia buscar os dados. Três
 * esperas em fila para mostrar uma lista de cômodos. Buscando aqui, a terceira
 * acontece em paralelo com a segunda, e o painel monta já preenchido.
 *
 * Por que uma chamada HTTP ao apps/api e não uma consulta direta ao banco: a
 * regra de cada leitura (quem é o dono, o que ele pode ver, que formato tem a
 * resposta) mora na rota. Reescrever a consulta aqui criaria uma segunda
 * versão da mesma regra, e as duas divergiriam no primeiro ajuste. A ida é em
 * loopback, custa cerca de um milissegundo, e é a MESMA resposta que o
 * navegador receberia.
 *
 * Falha em silêncio de propósito: isto é adiantamento, não a fonte da verdade.
 * Se o apps/api estiver lento ou fora do ar, a tela abre com o esqueleto e o
 * cliente busca como antes. Nada aqui pode segurar uma página.
 */
const API = process.env.API_URL ?? "http://127.0.0.1:3010";

/** Teto curto: passar disto significa que esperar já custa mais do que rende. */
const TIMEOUT_MS = Number(process.env.SEED_TIMEOUT_MS ?? 1500);

async function lerDaApi(caminho: string): Promise<unknown> {
  const h = await headers();
  const cookie = h.get("cookie");
  if (!cookie) return null; // sem sessão não há o que adiantar

  try {
    const r = await fetch(`${API}${caminho}`, {
      headers: {
        cookie,
        // o apps/api confere a origem pelo host que o navegador usou
        host: h.get("host") ?? "localhost:3000",
        accept: "application/json",
      },
      // este dado é do dono e do instante: nada de cache de fetch do Next aqui,
      // quem guarda é o cache de tela, no cliente
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/**
 * Lê vários caminhos em paralelo e devolve o mapa pronto para semear o cache
 * do cliente. Caminho que falhou simplesmente não entra: o painel busca sozinho.
 */
export async function semearDaApi(caminhos: readonly string[]): Promise<Record<string, unknown>> {
  // Com interruptor (`cache.adiantarLeituras`, tela em Ajustes): adiantar troca
  // "a tela aparece antes" por "a tela aparece pronta", e qual dos dois é
  // melhor depende da rede e do gosto de quem usa. Quem decide é o dono (§5.6).
  const ligado = await settings.get("cache.adiantarLeituras").catch(() => true);
  if (!ligado) return {};

  const pares = await Promise.all(caminhos.map(async (c) => [c, await lerDaApi(c)] as const));
  return Object.fromEntries(pares.filter(([, v]) => v !== null && v !== undefined));
}
