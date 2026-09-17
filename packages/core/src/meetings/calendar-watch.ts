import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { meetingReminder } from "@orbita/db/meeting-schema";
import { usersConnected, getAccessToken } from "../connectors/store";
import { listEventsStartingWithin, type CalEvent } from "../connectors/google";
import { retrieveContext } from "../rag/retrieve";
import { events } from "../events/index";
import { settings } from "../settings";
import { log } from "../observability/logger";

/**
 * Aviso pré-reunião (MTG.1) + Calendar watch (B1.7), por polling.
 *
 * Sem URL pública ainda (B9.1), não dá para usar o push nativo do Google
 * Calendar (exige um endpoint HTTPS registrado). O processo persistente
 * pergunta pela agenda a cada `meetings.calendarPollMinutes` e avisa quem tem
 * reunião começando dentro de `meetings.warnMinutesBefore` minutos.
 */

/** Eventos que ainda não foram avisados, dentro da janela — parte PURA, testável. */
export function eventsToWarn(calEvents: CalEvent[], alreadyRemindedIds: ReadonlySet<string>): CalEvent[] {
  return calEvents.filter((e) => e.start && !alreadyRemindedIds.has(e.id));
}

/** Texto pronto para a notificação (o motor de regras não tem `if`, então formatamos aqui). */
function formatResumo(ev: CalEvent, contexto: string | undefined): string {
  const hora = new Date(ev.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const partes = [`Às ${hora}`];
  if (ev.location) partes.push(`em ${ev.location}`);
  if (ev.link) partes.push(`(${ev.link})`);
  if (ev.attendees?.length) partes.push(`com ${ev.attendees.join(", ")}`);
  let out = partes.join(" ") + ".";
  if (contexto) out += ` Pendente: ${contexto}`;
  return out;
}

/** Contexto do que ficou pendente com essas pessoas/esse assunto (RAG), formatado curto. */
async function pendingContext(userId: string, ev: CalEvent): Promise<string | undefined> {
  const query = [ev.summary, ...(ev.attendees ?? [])].filter(Boolean).join(" ");
  if (!query.trim()) return undefined;
  try {
    const hits = await retrieveContext(userId, query, 2);
    if (!hits.length) return undefined;
    return hits.map((h) => h.content.slice(0, 200)).join(" · ");
  } catch {
    return undefined; // fail-soft: aviso sem contexto é melhor que nenhum aviso
  }
}

/** Uma volta: para cada usuário com Google conectado, avisa reuniões na janela. */
export async function emitUpcomingMeetings(): Promise<{ verificados: number; avisados: number }> {
  const [userIds, windowMinutes] = await Promise.all([usersConnected("google"), settings.get("meetings.warnMinutesBefore")]);
  let avisados = 0;
  for (const userId of userIds) {
    try {
      const token = await getAccessToken("google", userId);
      if (!token) continue;
      const upcoming = await listEventsStartingWithin(token, windowMinutes);
      if (!upcoming.length) continue;

      const already = await db.select({ calendarEventId: meetingReminder.calendarEventId }).from(meetingReminder).where(eq(meetingReminder.userId, userId));
      const due = eventsToWarn(upcoming, new Set(already.map((r) => r.calendarEventId)));

      for (const ev of due) {
        const contexto = await pendingContext(userId, ev);
        await events.emit(
          "calendar.meeting_upcoming",
          {
            calendarEventId: ev.id, titulo: ev.summary, inicio: ev.start, fim: ev.end,
            local: ev.location, link: ev.link, participantes: ev.attendees ?? [], contexto,
            resumo: formatResumo(ev, contexto),
          },
          { userId },
        );
        await db.insert(meetingReminder).values({ userId, calendarEventId: ev.id }).onConflictDoNothing();
        avisados++;
      }
    } catch (e) {
      log.warn("meetings.calendar_watch_falhou", { userId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { verificados: userIds.length, avisados };
}
