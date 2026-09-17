import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { events, fetchEventsAfter, latestEventId, pruneEvents } from "@orbita/core/events/index";
import { settings } from "@orbita/core/settings/index";
import { runDueRoutines, usersWithRoutines } from "@orbita/core/routines/run";
import { ensureBuiltinRules, fireCronRules, fireRulesForEvent } from "@orbita/core/rules/run";
import { refreshExpiringTokens } from "@orbita/core/connectors/refresh";
import { emitBillDueEvents } from "@orbita/core/finance/bill-due";
import { emitUpcomingMeetings } from "@orbita/core/meetings/calendar-watch";
import { emitImportantEmails } from "@orbita/core/meetings/gmail-watch";
import { usersWithHomeAssistant, getHaConnection } from "@orbita/core/home/connection";
import { syncEntities } from "@orbita/core/home/entities";
import { HomeAssistantWatcher } from "@orbita/core/home/ws-watcher";
import { purgeOldCameraEvents } from "@orbita/core/cameras/retention";
import { log } from "@orbita/core/observability/logger";

/**
 * O CRON REAL. Substitui o `setInterval` de 5 min que vivia em
 * components/routines-panel.tsx (o "gap raiz" do BRIEFING §4): agora a Órbita
 * age com o navegador fechado.
 *
 * Cada laço lê o próprio intervalo da config A CADA volta (mudou na tela, vale
 * na próxima), e uma volta que falha não mata o laço. Um só processo roda isto;
 * se um dia houver dois, o outbox de eventos e o `lastFiredAt` das regras já
 * evitam disparo duplo por evento, mas o tick de rotinas precisaria de lock.
 */
type Loop = { name: string; timer?: NodeJS.Timeout; stopped: boolean };

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private loops: Loop[] = [];
  private lastEventId = 0;
  private lastCronTick = new Date();
  private lastBillDueDay = "";
  /** um WebSocket vivo por usuário conectado ao Home Assistant (B3.4). */
  private haWatchers = new Map<string, HomeAssistantWatcher>();

  async onModuleInit() {
    // regras de evento: em processo, disparam na hora
    // sem await: uma ação `prompt` (LLM) não pode segurar a resposta HTTP de quem emitiu
    events.on("*", (ev) => {
      if (ev.source !== "api") return;
      void fireRulesForEvent(ev).catch((e) => log.error("rules.evento_falhou", { type: ev.type, error: String(e) }));
    });
    // ponto de partida do outbox: não reprocessa o que aconteceu antes do boot
    this.lastEventId = await latestEventId().catch(() => 0);
    await ensureBuiltinRules().catch((e) => log.warn("rules.builtin_falhou", { error: String(e) }));

    this.loop("routines", () => settings.get("routines.tickSeconds").then((s) => s * 1000), () => this.tickRoutines());
    this.loop("events", () => settings.get("events.pollMs"), () => this.drainOutbox());
    this.loop("tokens", () => settings.get("connectors.refreshCheckMinutes").then((m) => m * 60_000), () => this.tickTokens());
    this.loop("bills", () => Promise.resolve(60_000), () => this.tickBills());
    this.loop("calendar", () => settings.get("meetings.calendarPollMinutes").then((m) => m * 60_000), () => this.tickCalendar());
    this.loop("gmail", () => settings.get("meetings.gmailPollMinutes").then((m) => m * 60_000), () => this.tickGmail());
    this.loop("home-watch", () => settings.get("home.entitySyncMinutes").then((m) => m * 60_000), () => this.reconcileHaWatchers());
    this.loop("home-sync", () => settings.get("home.entitySyncMinutes").then((m) => m * 60_000), () => this.tickHomeSync());
    this.loop("prune", () => Promise.resolve(6 * 3_600_000), () => settings.get("events.retentionDays").then(pruneEvents));
    this.loop("camera-retention", () => Promise.resolve(6 * 3_600_000), () => settings.get("cameras.retentionDays").then(purgeOldCameraEvents));
    log.info("scheduler.up", { loops: this.loops.map((l) => l.name) });
  }

  onModuleDestroy() {
    for (const l of this.loops) {
      l.stopped = true;
      if (l.timer) clearTimeout(l.timer);
    }
    for (const w of this.haWatchers.values()) w.stop();
    this.haWatchers.clear();
  }

  /** Laço com intervalo dinâmico: setTimeout encadeado, nunca sobreposto. */
  private loop(name: string, intervalMs: () => Promise<number>, fn: () => Promise<unknown>) {
    const l: Loop = { name, stopped: false };
    this.loops.push(l);
    const run = async () => {
      if (l.stopped) return;
      try {
        await fn();
      } catch (e) {
        log.error("scheduler.volta_falhou", { loop: name, error: e instanceof Error ? e.message : String(e) });
      }
      const ms = await intervalMs().catch(() => 60_000);
      if (!l.stopped) l.timer = setTimeout(run, ms);
    };
    // primeira volta logo após o boot (dá tempo do banco responder)
    l.timer = setTimeout(run, 2_000);
  }

  /** Rotinas por intervalo (todos os usuários) + regras cron devidas. */
  private async tickRoutines() {
    for (const userId of await usersWithRoutines()) {
      const r = await runDueRoutines(userId);
      if (r.devidas) log.info("routines.tick", { userId, ...r });
    }
    const now = new Date();
    const fired = await fireCronRules(this.lastCronTick, now);
    this.lastCronTick = now;
    if (fired) log.info("rules.cron", { fired });
  }

  /** Lê eventos gravados por OUTROS processos (ex.: o Next) e despacha as regras. */
  private async drainOutbox() {
    const novos = await fetchEventsAfter(this.lastEventId);
    for (const ev of novos) {
      this.lastEventId = Math.max(this.lastEventId, ev.id ?? 0);
      if (ev.source === "api") continue; // os nossos já foram despachados em processo
      await events.dispatch(ev);
      await fireRulesForEvent(ev);
    }
  }

  private async tickTokens() {
    const r = await refreshExpiringTokens();
    if (r.verificados) log.info("connectors.refresh", r);
  }

  private async tickCalendar() {
    const r = await emitUpcomingMeetings();
    if (r.avisados) log.info("meetings.calendar_watch", r);
  }

  private async tickGmail() {
    const r = await emitImportantEmails();
    if (r.avisados) log.info("meetings.gmail_watch", r);
  }

  /**
   * Abre (ou fecha) o WebSocket do HA por usuário, acompanhando quem
   * conectou/desconectou desde a última volta (B3.4). O próprio
   * `HomeAssistantWatcher` cuida de reconectar sozinho enquanto a conexão
   * continuar cadastrada; aqui só reagimos a cadastrar/descadastrar.
   */
  private async reconcileHaWatchers() {
    const userIds = new Set(await usersWithHomeAssistant());
    for (const [userId, watcher] of this.haWatchers) {
      if (!userIds.has(userId)) {
        watcher.stop();
        this.haWatchers.delete(userId);
        log.info("home.watch_parado", { userId });
      }
    }
    const reconnectMs = await settings.get("home.wsReconnectMs");
    for (const userId of userIds) {
      if (this.haWatchers.has(userId)) continue;
      const conn = await getHaConnection(userId);
      if (!conn) continue;
      const watcher = new HomeAssistantWatcher({
        baseUrl: conn.baseUrl,
        token: conn.token,
        reconnectMs,
        onStateChanged: (ev) => {
          void events
            .emit("home.state_changed", { entityId: ev.entityId, newState: ev.newState, oldState: ev.oldState, attributes: ev.attributes }, { userId })
            .catch((e) => log.error("home.evento_falhou", { userId, error: String(e) }));
        },
      });
      watcher.start();
      this.haWatchers.set(userId, watcher);
      log.info("home.watch_iniciado", { userId });
    }
  }

  /** Sincroniza o índice semântico de entidades (B3.6) de todo mundo conectado. */
  private async tickHomeSync() {
    for (const userId of await usersWithHomeAssistant()) {
      const conn = await getHaConnection(userId);
      if (!conn) continue;
      try {
        const r = await syncEntities(userId, conn.baseUrl, conn.token);
        if (r.reembedded) log.info("home.entities_sync", { userId, ...r });
      } catch (e) {
        log.warn("home.sync_falhou", { userId, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  /** Uma vez por dia, na hora configurada (checado a cada minuto). */
  private async tickBills() {
    const hour = await settings.get("finance.billDueHour");
    const now = new Date();
    const dia = now.toISOString().slice(0, 10);
    if (now.getHours() !== hour || this.lastBillDueDay === dia) return;
    this.lastBillDueDay = dia;
    const n = await emitBillDueEvents();
    log.info("finance.bill_due.tick", { usuarios: n });
  }
}
