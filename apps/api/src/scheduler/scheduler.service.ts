import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { discoverModels, discoveryAgeMs, discoveredSnapshot, readPolicy, EMPTY_DISCOVERY_RETRY_MS } from "@orbita/llm";
import { events, fetchPendingEvents, markEventsProcessed, partitionPending, pruneEvents } from "@orbita/core/events/index";
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
import { purgeExpiredUnknownVoices } from "@orbita/core/identity/voice";
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
  private lastCronTick = new Date();
  private lastBillDueDay = "";
  /**
   * Um WebSocket vivo por usuário conectado ao Home Assistant (B3.4).
   * `fingerprint` é `baseUrl+token`: se o dono trocar o token ou a URL, o
   * watcher antigo (autenticado com a credencial velha) precisa ser
   * recriado, não só mantido porque o userId continua na lista (achado de
   * auditoria pós-Onda 6 — sem isto, trocar o token deixava o WS morto até
   * reiniciar o processo).
   */
  private haWatchers = new Map<string, { watcher: HomeAssistantWatcher; fingerprint: string }>();

  async onModuleInit() {
    // regras de evento: em processo, disparam na hora
    // sem await: uma ação `prompt` (LLM) não pode segurar a resposta HTTP de quem emitiu
    events.on("*", (ev) => {
      if (ev.source !== "api") return;
      void fireRulesForEvent(ev).catch((e) => log.error("rules.evento_falhou", { type: ev.type, error: String(e) }));
    });
    await ensureBuiltinRules().catch((e) => log.warn("rules.builtin_falhou", { error: String(e) }));

    this.loop("routines", () => settings.get("routines.tickSeconds").then((s) => s * 1000), () => this.tickRoutines());
    this.loop("events", () => settings.get("events.pollMs"), () => this.drainOutbox());
    this.loop("tokens", () => settings.get("connectors.refreshCheckMinutes").then((m) => m * 60_000), () => this.tickTokens());
    this.loop("bills", () => settings.get("finance.billCheckMinutes").then((m) => m * 60_000), () => this.tickBills());
    // descoberta de modelos aquecida aqui, fora do turno do chat (RV.3)
    // lista vazia (Ollama ainda subindo) volta a tentar em segundos, não num TTL inteiro
    this.loop("models-warm", () => readPolicy().then((p) => (discoveredSnapshot().length ? p.discoveryTtlMs : EMPTY_DISCOVERY_RETRY_MS)), () => this.warmModels());
    this.loop("calendar", () => settings.get("meetings.calendarPollMinutes").then((m) => m * 60_000), () => this.tickCalendar());
    this.loop("gmail", () => settings.get("meetings.gmailPollMinutes").then((m) => m * 60_000), () => this.tickGmail());
    this.loop("home-watch", () => settings.get("home.entitySyncMinutes").then((m) => m * 60_000), () => this.reconcileHaWatchers());
    this.loop("home-sync", () => settings.get("home.entitySyncMinutes").then((m) => m * 60_000), () => this.tickHomeSync());
    const pruneEvery = () => settings.get("events.pruneEveryHours").then((h) => h * 3_600_000);
    this.loop("prune", pruneEvery, () => settings.get("events.retentionDays").then(pruneEvents));
    this.loop("camera-retention", pruneEvery, () => settings.get("cameras.retentionDays").then(purgeOldCameraEvents));
    // desconhecido efêmero (decisão 9.2): a validade já foi gravada com a retenção vigente
    this.loop("unknown-retention", pruneEvery, () => purgeExpiredUnknownVoices());
    log.info("scheduler.up", { loops: this.loops.map((l) => l.name) });
  }

  onModuleDestroy() {
    for (const l of this.loops) {
      l.stopped = true;
      if (l.timer) clearTimeout(l.timer);
    }
    for (const { watcher } of this.haWatchers.values()) watcher.stop();
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

  /**
   * Despacha o que outros processos (ex.: o Next) gravaram e ainda não foi
   * processado (RV.5). Marca um a um DEPOIS de despachar: se o processo cair no
   * meio, o que já foi feito não repete. Uma regra que quebra não trava a fila:
   * o evento é marcado mesmo assim (senão viraria veneno reprocessado para sempre).
   */
  private async drainOutbox() {
    const pendentes = await fetchPendingEvents();
    if (!pendentes.length) return;
    const maxAgeMs = (await settings.get("events.pendingMaxAgeHours")) * 3_600_000;
    const { despachar, vencidos } = partitionPending(pendentes, new Date(), maxAgeMs);
    if (vencidos.length) {
      await markEventsProcessed(vencidos.map((e) => e.id!));
      log.warn("events.pendentes_vencidos", { quantidade: vencidos.length });
    }
    for (const ev of despachar) {
      try {
        await events.dispatch(ev);
        await fireRulesForEvent(ev);
      } catch (e) {
        log.error("events.despacho_falhou", { type: ev.type, id: ev.id, error: e instanceof Error ? e.message : String(e) });
      } finally {
        await markEventsProcessed([ev.id!]);
      }
    }
  }

  /** Renova a lista de modelos quando passa do TTL, para o chat nunca esperar a descoberta. */
  private async warmModels() {
    const { discoveryTtlMs } = await readPolicy();
    if (discoveryAgeMs() < discoveryTtlMs) return;
    const models = await discoverModels({ force: true });
    log.info("models.aquecidos", { total: models.length });
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
   * conectou/desconectou desde a última volta (B3.4), quem trocou de
   * URL/token (o `fingerprint` muda) e quem falhou a autenticação
   * (`watcher.failed`) — nos três casos, o watcher velho para e um novo é
   * criado com a conexão atual. `HomeAssistantWatcher` só reconecta sozinho
   * numa queda de rede; credencial ruim não se autocorrige.
   */
  private async reconcileHaWatchers() {
    const userIds = new Set(await usersWithHomeAssistant());
    for (const [userId, entry] of this.haWatchers) {
      if (!userIds.has(userId) || entry.watcher.failed) {
        entry.watcher.stop();
        this.haWatchers.delete(userId);
        log.info("home.watch_parado", { userId, motivo: entry.watcher.failed ? "auth_invalida" : "desconectado" });
      }
    }
    const reconnectMs = await settings.get("home.wsReconnectMs");
    for (const userId of userIds) {
      const conn = await getHaConnection(userId);
      if (!conn) continue;
      const fingerprint = `${conn.baseUrl} ${conn.token}`;
      const existing = this.haWatchers.get(userId);
      if (existing) {
        if (existing.fingerprint === fingerprint) continue;
        existing.watcher.stop();
        this.haWatchers.delete(userId);
        log.info("home.watch_reconectando", { userId, motivo: "credencial_trocada" });
      }
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
      this.haWatchers.set(userId, { watcher, fingerprint });
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
