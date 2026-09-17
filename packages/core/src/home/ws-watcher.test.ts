import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { HomeAssistantWatcher, _internal } from "./ws-watcher";

const { toWsUrl } = _internal;

describe("toWsUrl", () => {
  it("converte http/https para ws/wss e aponta para /api/websocket", () => {
    expect(toWsUrl("http://192.168.1.50:8123")).toBe("ws://192.168.1.50:8123/api/websocket");
    expect(toWsUrl("https://casa.duckdns.org")).toBe("wss://casa.duckdns.org/api/websocket");
  });
  it("descarta path e query da baseUrl salva", () => {
    expect(toWsUrl("http://192.168.1.50:8123/lovelace?tab=1")).toBe("ws://192.168.1.50:8123/api/websocket");
  });
});

/** Fake mínimo do `ws.WebSocket`: EventEmitter + send()/close() espiados. */
class FakeSocket extends EventEmitter {
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.emit("close");
  }
}

describe("HomeAssistantWatcher", () => {
  function setup() {
    const socket = new FakeSocket();
    const onStateChanged = vi.fn();
    const watcher = new HomeAssistantWatcher({
      baseUrl: "http://192.168.1.50:8123",
      token: "tok-123",
      onStateChanged,
      wsFactory: () => socket as unknown as import("ws").WebSocket,
      onLog: () => {},
    });
    return { socket, onStateChanged, watcher };
  }

  it("completa o handshake: auth_required → auth → auth_ok → subscribe_events", () => {
    const { socket, watcher } = setup();
    watcher.start();
    socket.emit("message", Buffer.from(JSON.stringify({ type: "auth_required" })));
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: "auth", access_token: "tok-123" });

    socket.emit("message", Buffer.from(JSON.stringify({ type: "auth_ok" })));
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({ type: "subscribe_events", event_type: "state_changed" });
    watcher.stop();
  });

  it("extrai entityId/newState/oldState de um evento state_changed", () => {
    const { socket, onStateChanged, watcher } = setup();
    watcher.start();
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "event",
          event: {
            event_type: "state_changed",
            data: {
              entity_id: "lock.porta_frente",
              new_state: { state: "unlocked", attributes: { friendly_name: "Porta da frente" } },
              old_state: { state: "locked" },
            },
          },
        }),
      ),
    );
    expect(onStateChanged).toHaveBeenCalledWith({
      entityId: "lock.porta_frente",
      newState: "unlocked",
      oldState: "locked",
      attributes: { friendly_name: "Porta da frente" },
    });
    watcher.stop();
  });

  it("ignora eventos de outro tipo (não state_changed)", () => {
    const { socket, onStateChanged, watcher } = setup();
    watcher.start();
    socket.emit("message", Buffer.from(JSON.stringify({ type: "event", event: { event_type: "outro_tipo", data: {} } })));
    expect(onStateChanged).not.toHaveBeenCalled();
    watcher.stop();
  });

  it("mensagem não-JSON não derruba o watcher", () => {
    const { socket, onStateChanged, watcher } = setup();
    watcher.start();
    expect(() => socket.emit("message", Buffer.from("isto não é json"))).not.toThrow();
    expect(onStateChanged).not.toHaveBeenCalled();
    watcher.stop();
  });

  it("auth_invalid fecha o socket sem lançar", () => {
    const { socket, watcher } = setup();
    watcher.start();
    expect(() => socket.emit("message", Buffer.from(JSON.stringify({ type: "auth_invalid", message: "token errado" })))).not.toThrow();
    watcher.stop();
  });

  it("reconecta depois de close, usando uma nova instância do factory", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const watcher = new HomeAssistantWatcher({
      baseUrl: "http://192.168.1.50:8123",
      token: "tok",
      onStateChanged: () => {},
      reconnectMs: 1000,
      onLog: () => {},
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as import("ws").WebSocket;
      },
    });
    watcher.start();
    expect(sockets).toHaveLength(1);
    sockets[0]!.emit("close");
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    watcher.stop();
    vi.useRealTimers();
  });

  it("stop() não agenda reconexão", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const watcher = new HomeAssistantWatcher({
      baseUrl: "http://192.168.1.50:8123",
      token: "tok",
      onStateChanged: () => {},
      reconnectMs: 1000,
      onLog: () => {},
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as import("ws").WebSocket;
      },
    });
    watcher.start();
    watcher.stop();
    vi.advanceTimersByTime(5000);
    expect(sockets).toHaveLength(1);
    vi.useRealTimers();
  });
});
