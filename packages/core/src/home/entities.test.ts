import { describe, it, expect } from "vitest";
import { embedTextFor } from "./entities";
import type { HaState } from "./client";

describe("embedTextFor", () => {
  it("usa o friendly_name quando existe", () => {
    const s: HaState = { entity_id: "light.living_room", state: "on", attributes: { friendly_name: "Luz da Sala" }, last_changed: "" };
    expect(embedTextFor(s)).toBe("Luz da Sala (light)");
  });
  it("cai no entity_id quando não há friendly_name", () => {
    const s: HaState = { entity_id: "light.living_room", state: "on", attributes: {}, last_changed: "" };
    expect(embedTextFor(s)).toBe("light.living_room (light)");
  });
});
