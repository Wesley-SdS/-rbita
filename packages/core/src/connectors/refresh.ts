import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@orbita/db";
import { connection } from "@orbita/db/connector-schema";
import { decryptSecret } from "../crypto";
import { refreshConnectionToken } from "./store";
import type { ConnectorId } from "./registry";
import { events } from "../events/index";
import { settings } from "../settings";
import { log } from "../observability/logger";

/**
 * Pode tentar renovar de novo? Espera cresce em dobro a cada falha seguida
 * (base = intervalo do laço), com teto configurável (RV.4). Puro.
 */
export function refreshDue(failures: number, failedAt: Date | null, now: Date, baseMs: number, maxMs: number): boolean {
  if (failures <= 0 || !failedAt) return true;
  const espera = Math.min(baseMs * 2 ** (failures - 1), maxMs);
  return now.getTime() - failedAt.getTime() >= espera;
}

/**
 * Renovação de token em segundo plano.
 *
 * Antes, o refresh só acontecia dentro de um request (`getAccessToken`): com o
 * app fechado por dias o access token expirava e, no Google, o refresh token
 * de um app em "teste" morre em 7 dias sem uso. Agora o processo persistente
 * renova o que está perto de expirar, e o Calendar watch da Onda 2 e as regras
 * proativas encontram o conector sempre pronto.
 *
 * Conexão revogada avisava a cada volta do laço (a cada 10 min) até o dono
 * desconectar na mão. Agora a falha fica gravada na conexão: o evento
 * `connector.refresh_failed` sai só na PRIMEIRA falha seguida, e as tentativas
 * seguintes esperam cada vez mais (RV.4).
 */
export async function refreshExpiringTokens(): Promise<{ verificados: number; renovados: number; adiados: number }> {
  const cfg = await settings.getMany(["connectors.refreshAheadMinutes", "connectors.refreshCheckMinutes", "connectors.refreshBackoffMaxHours"]);
  const now = new Date();
  const limite = new Date(now.getTime() + cfg["connectors.refreshAheadMinutes"] * 60_000);
  const rows = await db
    .select({
      userId: connection.userId,
      provider: connection.provider,
      refreshTokenEnc: connection.refreshTokenEnc,
      refreshFailures: connection.refreshFailures,
      refreshFailedAt: connection.refreshFailedAt,
    })
    .from(connection)
    .where(and(isNotNull(connection.refreshTokenEnc), isNotNull(connection.expiresAt), lte(connection.expiresAt, limite)));

  const baseMs = cfg["connectors.refreshCheckMinutes"] * 60_000;
  const maxMs = cfg["connectors.refreshBackoffMaxHours"] * 3_600_000;
  let renovados = 0;
  let adiados = 0;
  for (const r of rows) {
    if (!r.refreshTokenEnc) continue;
    if (!refreshDue(r.refreshFailures, r.refreshFailedAt, now, baseMs, maxMs)) {
      adiados++;
      continue;
    }
    const alvo = and(eq(connection.userId, r.userId), eq(connection.provider, r.provider));
    try {
      await refreshConnectionToken(r.provider as ConnectorId, r.userId, decryptSecret(r.refreshTokenEnc));
      renovados++;
      await events.emit("connector.token_refreshed", { provider: r.provider }, { userId: r.userId });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const falhas = r.refreshFailures + 1;
      await db.update(connection).set({ refreshFailures: falhas, refreshFailedAt: now }).where(alvo);
      log.warn("connectors.refresh_falhou", { provider: r.provider, userId: r.userId, falhas, error });
      // avisa UMA vez (vira evento para regra/notificação "reconecte"); as próximas só registram
      if (falhas === 1) await events.emit("connector.refresh_failed", { provider: r.provider, error }, { userId: r.userId });
    }
  }
  return { verificados: rows.length, renovados, adiados };
}
