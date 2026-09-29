import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { meetingReminder } from "@orbita/db/meeting-schema";
import { usersConnected } from "../connectors/store";
import { lerDeTodasAsContas } from "../connectors/multi";
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

/**
 * Eventos que ainda não foram avisados, dentro da janela. PURA, testável.
 *
 * `soReunioes`: a agenda do dono tem lembrete de hábito ("Água +600 ml") e
 * bloco de foco, e cada um virava "Reunião em breve" no sino e no WhatsApp.
 * Reunião é o que tem outra pessoa ou link de chamada. Evento de dia inteiro
 * (sem hora) nunca é "daqui a 15 minutos".
 */
export function eventsToWarn(calEvents: CalEvent[], alreadyRemindedIds: ReadonlySet<string>, opts: { soReunioes?: boolean } = {}): CalEvent[] {
  return calEvents.filter((e) => {
    if (!e.start || alreadyRemindedIds.has(e.id)) return false;
    if (!opts.soReunioes) return true;
    return e.start.includes("T") && ((e.attendees?.length ?? 0) > 0 || !!e.link);
  });
}

/** Texto pronto para a notificação (o motor de regras não tem `if`, então formatamos aqui). */
function formatResumo(ev: CalEvent, contexto: string | undefined, fuso: string): string {
  const quando = new Date(ev.start);
  let hora: string;
  try {
    hora = quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fuso || undefined });
  } catch {
    // fuso digitado errado em Ajustes não pode derrubar o aviso
    hora = quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const partes = [`Às ${hora}`];
  if (ev.location) partes.push(`em ${ev.location}`);
  if (ev.attendees?.length) partes.push(`com ${ev.attendees.join(", ")}`);
  let out = partes.join(" ") + ".";
  if (ev.link) out += ` Link: ${ev.link}`;
  if (contexto) out += `\n\nDa sua base, sobre isso: ${contexto}`;
  return out;
}

const PALAVRA = /[\p{L}\p{N}]+/gu;
const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Só o trecho da base que fala DESTA reunião. PURA.
 *
 * A busca híbrida sempre devolve alguma coisa, mesmo sem nada a ver: o aviso
 * saía com "Pendente:" seguido de um pedaço aleatório de documento. O trecho
 * fica só se citar alguém da reunião (primeiro nome) ou uma palavra longa do
 * título, que é o mínimo para "isso é sobre essa reunião".
 */
export function contextoRelevante(ev: Pick<CalEvent, "summary" | "attendees">, trechos: string[]): string[] {
  const chaves = new Set<string>();
  for (const a of ev.attendees ?? []) {
    const primeiro = semAcento(a.split(/[\s@.]/)[0] ?? "");
    if (primeiro.length >= 3) chaves.add(primeiro);
  }
  for (const w of semAcento(ev.summary).match(PALAVRA) ?? []) if (w.length >= 5) chaves.add(w);
  if (!chaves.size) return [];
  return trechos.filter((t) => (semAcento(t).match(PALAVRA) ?? []).some((w) => chaves.has(w)));
}

/** Contexto do que ficou pendente com essas pessoas/esse assunto (RAG), formatado curto. */
async function pendingContext(userId: string, ev: CalEvent): Promise<string | undefined> {
  // sem ninguém na reunião, "o que ficou pendente com eles" não tem sujeito
  if (!ev.attendees?.length) return undefined;
  const query = [ev.summary, ...ev.attendees].filter(Boolean).join(" ");
  try {
    const hits = await retrieveContext(userId, query, 4);
    const bons = contextoRelevante(ev, hits.map((h) => h.content.slice(0, 200)));
    return bons.length ? bons.slice(0, 2).join(" · ") : undefined;
  } catch {
    return undefined; // fail-soft: aviso sem contexto é melhor que nenhum aviso
  }
}

/** Uma volta: para cada usuário com Google conectado, avisa reuniões na janela. */
export async function emitUpcomingMeetings(): Promise<{ verificados: number; avisados: number }> {
  const [userIds, windowMinutes, soReunioes] = await Promise.all([
    usersConnected("google"), settings.get("meetings.warnMinutesBefore"), settings.get("meetings.avisarSoReunioes"),
  ]);
  // o processo pode rodar num servidor em UTC: a hora do aviso é a da casa
  const fuso = await settings.get("connectors.fusoHorario").catch(() => "");
  let avisados = 0;
  for (const userId of userIds) {
    try {
      // TODAS as agendas conectadas, não só a principal: a reunião do trabalho
      // está na conta do trabalho, e era justamente ela que nunca gerava aviso
      const { itens: upcoming } = await lerDeTodasAsContas("google", userId, (t) => listEventsStartingWithin(t, windowMinutes));
      if (!upcoming.length) continue;

      const already = await db.select({ calendarEventId: meetingReminder.calendarEventId }).from(meetingReminder).where(eq(meetingReminder.userId, userId));
      const due = eventsToWarn(upcoming, new Set(already.map((r) => r.calendarEventId)), { soReunioes });

      for (const ev of due) {
        const contexto = await pendingContext(userId, ev);
        await events.emit(
          "calendar.meeting_upcoming",
          {
            calendarEventId: ev.id, titulo: ev.summary, inicio: ev.start, fim: ev.end,
            local: ev.location, link: ev.link, participantes: ev.attendees ?? [], contexto,
            resumo: formatResumo(ev, contexto, fuso),
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
