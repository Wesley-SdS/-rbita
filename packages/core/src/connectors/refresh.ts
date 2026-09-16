import { and, isNotNull, lte } from "drizzle-orm";
import { db } from "@orbita/db";
import { connection } from "@orbita/db/connector-schema";
import { decryptSecret } from "../crypto";
import { refreshConnectionToken } from "./store";
import type { ConnectorId } from "./registry";
import { events } from "../events/index";
import { settings } from "../settings";
import { log } from "../observability/logger";

/**
 * Renovação de token em segundo plano.
 *
 * Antes, o refresh só acontecia dentro de um request (`getAccessToken`): com o
 * app fechado por dias o access token expirava e, no Google, o refresh token
 * de um app em "teste" morre em 7 dias sem uso. Agora o processo persistente
 * renova o que está perto de expirar, e o Calendar watch da Onda 2 e as regras
 * proativas encontram o conector sempre pronto.
 */
export async function refreshExpiringTokens(): Promise<{ verificados: number; renovados: number }> {
  const ahead = await settings.get("connectors.refreshAheadMinutes");
  const limite = new Date(Date.now() + ahead * 60_000);
  const rows = await db
    .select({ userId: connection.userId, provider: connection.provider, refreshTokenEnc: connection.refreshTokenEnc })
    .from(connection)
    .where(and(isNotNull(connection.refreshTokenEnc), isNotNull(connection.expiresAt), lte(connection.expiresAt, limite)));

  let renovados = 0;
  for (const r of rows) {
    if (!r.refreshTokenEnc) continue;
    try {
      await refreshConnectionToken(r.provider as ConnectorId, r.userId, decryptSecret(r.refreshTokenEnc));
      renovados++;
      await events.emit("connector.token_refreshed", { provider: r.provider }, { userId: r.userId });
    } catch (e) {
      // o refresh pode falhar por revogação: avisa (vira evento para regra/notificação) e segue
      log.warn("connectors.refresh_falhou", { provider: r.provider, userId: r.userId, error: e instanceof Error ? e.message : String(e) });
      await events.emit("connector.refresh_failed", { provider: r.provider, error: e instanceof Error ? e.message : String(e) }, { userId: r.userId });
    }
  }
  return { verificados: rows.length, renovados };
}
