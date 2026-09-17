import { describe, it, expect, vi } from "vitest";
import { createEventBus, partitionPending, type OrbitaEvent } from "./bus";

describe("event bus", () => {
  it("emite, persiste e entrega para handler do tipo e para o coringa", async () => {
    const persisted: OrbitaEvent[] = [];
    const bus = createEventBus({ source: "teste", persist: async (ev) => { persisted.push(ev); return 7; } });
    const exato = vi.fn();
    const todos = vi.fn();
    bus.on("a.b", exato);
    bus.on("*", todos);
    await bus.emit("a.b", { x: 1 }, { userId: "u1" });
    await bus.emit("c.d", { y: 2 });
    expect(exato).toHaveBeenCalledTimes(1);
    expect(todos).toHaveBeenCalledTimes(2);
    expect(persisted[0]).toMatchObject({ type: "a.b", userId: "u1", source: "teste", payload: { x: 1 }, id: 7 });
    expect(persisted[1]).toMatchObject({ type: "c.d", userId: null });
  });

  it("handler que lança não impede os outros nem o emissor", async () => {
    const bus = createEventBus({ source: "teste" });
    bus.on("x", () => { throw new Error("quebrei"); });
    const ok = vi.fn();
    bus.on("x", ok);
    await expect(bus.emit("x", {})).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalled();
  });

  it("falha na persistência não impede a entrega local", async () => {
    const bus = createEventBus({ source: "teste", persist: async () => { throw new Error("db fora"); } });
    const h = vi.fn();
    bus.on("x", h);
    await bus.emit("x", { a: 1 });
    expect(h).toHaveBeenCalledTimes(1);
    const ev = h.mock.calls[0]![0] as OrbitaEvent;
    expect(ev.type).toBe("x");
    expect(ev.id).toBeUndefined();
  });

  it("on() devolve unsubscribe", async () => {
    const bus = createEventBus({ source: "teste" });
    const h = vi.fn();
    const off = bus.on("x", h);
    off();
    await bus.emit("x", {});
    expect(h).not.toHaveBeenCalled();
  });
});

describe("outbox pendente (RV.5)", () => {
  const agora = new Date("2026-09-17T12:00:00Z");
  const ev = (id: number, horasAtras: number) => ({ id, at: new Date(agora.getTime() - horasAtras * 3_600_000) });

  it("despacha o recente e só marca o que ficou parado demais", () => {
    const { despachar, vencidos } = partitionPending([ev(1, 30), ev(2, 1), ev(3, 0)], agora, 24 * 3_600_000);
    expect(despachar.map((e) => e.id)).toEqual([2, 3]);
    expect(vencidos.map((e) => e.id)).toEqual([1]);
  });

  it("lista vazia", () => {
    expect(partitionPending([], agora, 1000)).toEqual({ despachar: [], vencidos: [] });
  });
});
