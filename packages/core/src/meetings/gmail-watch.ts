import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { gmailWatchState } from "@orbita/db/meeting-schema";
import { usersConnected, getAccessToken } from "../connectors/store";
import { listImportantUnread, type ImportantEmail } from "../connectors/google";
import { events } from "../events/index";
import { log } from "../observability/logger";

/**
 * Gmail watch (B1.6), por polling. O Pub/Sub do Google exige um projeto GCP
 * com domínio verificado — peso desnecessário para um dono só, e a mesma
 * limitação de URL pública do Calendar watch. Usamos o rótulo `IMPORTANT` que
 * o próprio Gmail já calcula (sem treinar classificador nenhum): a cada volta,
 * perguntamos por e-mails não lidos e importantes, e filtramos os mais novos
 * que o cursor salvo.
 */

/** Mensagens mais novas que o cursor salvo — parte PURA, testável. */
export function newImportantMessages(messages: ImportantEmail[], since: Date | null): ImportantEmail[] {
  if (!since) return []; // primeira volta: só grava o cursor, não inunda com o histórico
  return messages.filter((m) => m.internalDate.getTime() > since.getTime());
}

/** Uma volta: para cada usuário com Google conectado, avisa e-mail importante novo. */
export async function emitImportantEmails(): Promise<{ verificados: number; avisados: number }> {
  const userIds = await usersConnected("google");
  let avisados = 0;
  for (const userId of userIds) {
    try {
      const token = await getAccessToken("google", userId);
      if (!token) continue;

      const [state] = await db.select().from(gmailWatchState).where(eq(gmailWatchState.userId, userId)).limit(1);
      const messages = await listImportantUnread(token);
      const novas = newImportantMessages(messages, state?.lastSeenAt ?? null);

      for (const m of novas) {
        await events.emit("gmail.important_received", { messageId: m.id, de: m.from, assunto: m.subject, trecho: m.snippet }, { userId });
        avisados++;
      }

      const maisRecente = messages.reduce<Date | null>((max, m) => (!max || m.internalDate > max ? m.internalDate : max), state?.lastSeenAt ?? null);
      if (maisRecente) {
        await db
          .insert(gmailWatchState)
          .values({ userId, lastSeenAt: maisRecente, updatedAt: new Date() })
          .onConflictDoUpdate({ target: gmailWatchState.userId, set: { lastSeenAt: maisRecente, updatedAt: new Date() } });
      } else if (!state) {
        // sem e-mail importante nenhum ainda: grava o cursor em "agora" mesmo assim
        await db.insert(gmailWatchState).values({ userId, lastSeenAt: new Date(), updatedAt: new Date() }).onConflictDoNothing();
      }
    } catch (e) {
      log.warn("meetings.gmail_watch_falhou", { userId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { verificados: userIds.length, avisados };
}
