import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "segredo-de-teste-suficientemente-longo-000";
});

describe("state OAuth (anti-CSRF)", () => {
  it("assina e valida, devolvendo o userId", async () => {
    const { signState, verifyState } = await import("./state");
    const s = signState("user-123");
    expect(verifyState(s)).toBe("user-123");
  });

  it("rejeita state adulterado", async () => {
    const { signState, verifyState } = await import("./state");
    const s = signState("user-123");
    const tampered = s.replace("user-123", "user-999");
    expect(verifyState(tampered)).toBeNull();
  });

  it("rejeita lixo e vazio", async () => {
    const { verifyState } = await import("./state");
    expect(verifyState(null)).toBeNull();
    expect(verifyState("a.b")).toBeNull();
    expect(verifyState("a.b.c")).toBeNull();
  });
});

describe("registry de conectores", () => {
  it("lista os 3 conectores como não-configurados sem env", async () => {
    // garante ausência das credenciais
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.NOTION_CLIENT_ID;
    delete process.env.SLACK_CLIENT_ID;
    const { listConnectors } = await import("./registry");
    const list = listConnectors();
    expect(list.map((c) => c.id).sort()).toEqual(["google", "notion", "slack"]);
    expect(list.every((c) => c.configured === false)).toBe(true);
  });

  it("monta o redirect_uri a partir do BETTER_AUTH_URL", async () => {
    process.env.BETTER_AUTH_URL = "https://orbita.exemplo.com";
    const { redirectUri } = await import("./registry");
    expect(redirectUri("google")).toBe("https://orbita.exemplo.com/api/connectors/google/callback");
  });
});
