import WebSocket from "ws";
import { log } from "../observability/logger";

/**
 * WebSocket de eventos do Home Assistant (B3.4): o comando vai por REST
 * (`client.ts`), o evento volta por aqui — é o que faz "a porta abriu" virar
 * uma regra proativa sem o dono perguntar. Depende do processo persistente
 * (Onda 1): só existe porque o `apps/api` fica de pé.
 *
 * Protocolo (HA websocket API): conecta, recebe `auth_required`, manda
 * `{type:"auth", access_token}`, recebe `auth_ok` (ou `auth_invalid`),
 * manda `{type:"subscribe_events", event_type:"state_changed"}`.
 */
export interface HaStateChangedEvent {
  entityId: string;
  newState: string | null;
  oldState: string | null;
  attributes: Record<string, unknown>;
}

export interface HaWatcherOptions {
  baseUrl: string;
  token: string;
  onStateChanged: (ev: HaStateChangedEvent) => void;
  /** ms de espera antes de reconectar após queda; default 5000. */
  reconnectMs?: number;
  onLog?: (msg: string, fields?: Record<string, unknown>) => void;
  /** injeção para teste; default cria um `ws.WebSocket` de verdade. */
  wsFactory?: (url: string) => WebSocket;
}

function toWsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/websocket";
  u.search = "";
  return u.toString();
}

type HaMessage =
  | { type: "auth_required" }
  | { type: "auth_ok" }
  | { type: "auth_invalid"; message?: string }
  | { type: "event"; event: { event_type: string; data: { entity_id: string; new_state: { state: string; attributes: Record<string, unknown> } | null; old_state: { state: string } | null } } }
  | { type: "result"; success: boolean };

export class HomeAssistantWatcher {
  private ws: WebSocket | null = null;
  private closed = false;
  private authFailed = false;
  private msgId = 1;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private opts: HaWatcherOptions) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  /**
   * Token/URL inválidos (auditoria pós-Onda 6): reconectar sozinho é inútil e
   * bate no HA a cada `reconnectMs` até o dono reiniciar o `apps/api`. Quem
   * decide criar um watcher novo é o `SchedulerService`, quando o dono
   * salvar uma conexão nova — por isso isto fica público, não só um log.
   */
  get failed(): boolean {
    return this.authFailed;
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private log(msg: string, fields?: Record<string, unknown>) {
    (this.opts.onLog ?? log.info)(msg, fields);
  }

  private connect(): void {
    let ws: WebSocket;
    try {
      ws = (this.opts.wsFactory ?? ((url) => new WebSocket(url)))(toWsUrl(this.opts.baseUrl));
    } catch (e) {
      this.log("home.ws_url_invalida", { error: e instanceof Error ? e.message : String(e) });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on("message", (raw) => {
      let msg: HaMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: this.opts.token }));
      } else if (msg.type === "auth_ok") {
        ws.send(JSON.stringify({ id: this.msgId++, type: "subscribe_events", event_type: "state_changed" }));
      } else if (msg.type === "auth_invalid") {
        this.log("home.ws_auth_invalida", { message: msg.message });
        // token/URL inválidos: reconectar sozinho só bateria no HA de novo com a
        // mesma credencial ruim. Marca como falho e para — o reconcile do
        // scheduler recria quando o dono salvar uma conexão nova.
        this.authFailed = true;
        this.closed = true;
        ws.close();
      } else if (msg.type === "event" && msg.event.event_type === "state_changed") {
        const { entity_id, new_state, old_state } = msg.event.data;
        this.opts.onStateChanged({
          entityId: entity_id,
          newState: new_state?.state ?? null,
          oldState: old_state?.state ?? null,
          attributes: new_state?.attributes ?? {},
        });
      }
    });

    ws.on("close", () => {
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    });
    ws.on("error", (e) => {
      this.log("home.ws_erro", { error: e instanceof Error ? e.message : String(e) });
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), this.opts.reconnectMs ?? 5000);
  }
}

/** Testável sem WebSocket de verdade: só a conversão de URL. */
export const _internal = { toWsUrl };
