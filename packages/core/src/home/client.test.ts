import { describe, it, expect, vi, afterEach } from "vitest";
import { callService, getState, HomeAssistantError, listStates, pingHomeAssistant } from "./client";

afterEach(() => vi.restoreAllMocks());

describe("cliente Home Assistant", () => {
  it("pingHomeAssistant monta o rótulo a partir de /api/config", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: "2026.9.1", location_name: "Casa" })));
    const r = await pingHomeAssistant("http://192.168.1.50:8123", "tok");
    expect(r).toEqual({ ok: true, label: "Casa · HA 2026.9.1" });
  });

  it("listStates devolve a lista de entidades", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ entity_id: "light.sala", state: "on", attributes: {}, last_changed: "2026-09-17T10:00:00Z" }])),
    );
    const r = await listStates("http://192.168.1.50:8123", "tok");
    expect(r).toHaveLength(1);
    expect(r[0].entity_id).toBe("light.sala");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("getState busca uma entidade específica", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ entity_id: "lock.porta", state: "locked", attributes: {}, last_changed: "" })),
    );
    const r = await getState("http://192.168.1.50:8123", "tok", "lock.porta");
    expect(r.state).toBe("locked");
  });

  it("callService faz POST em /api/services/<dominio>/<servico> com o corpo", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    await callService("http://192.168.1.50:8123", "tok", "light", "turn_on", { entity_id: "light.sala" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/services/light/turn_on");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ entity_id: "light.sala" });
  });

  it("status HTTP de erro vira HomeAssistantError com o status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("não autorizado", { status: 401 }));
    await expect(listStates("http://192.168.1.50:8123", "tok-invalido")).rejects.toMatchObject({ status: 401 });
  });

  it("falha de rede vira HomeAssistantError, não uma exceção crua", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(listStates("http://192.168.1.50:8123", "tok")).rejects.toBeInstanceOf(HomeAssistantError);
  });

  it("recusa base URL que aponta para metadata de nuvem, mesmo sendo 'endereço local'", async () => {
    await expect(listStates("http://169.254.169.254", "tok")).rejects.toBeInstanceOf(HomeAssistantError);
  });
});
