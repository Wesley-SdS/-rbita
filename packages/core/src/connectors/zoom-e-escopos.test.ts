import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Conectores novos das reuniões online (27/09/2026):
 *   - o Zoom quer as credenciais do app em Basic, e TROCA o refresh token a
 *     cada renovação (guardar só o access token derrubava a conexão na segunda);
 *   - a transcrição do Teams só é pedida quando o dono liga a opção: pedida
 *     sempre, ela exigiria o administrador e impediria até conectar o Outlook.
 */

process.env.ZOOM_CLIENT_ID = "zid";
process.env.ZOOM_CLIENT_SECRET = "zsecret";
process.env.MICROSOFT_CLIENT_ID = "mid";
process.env.GOOGLE_CLIENT_ID = "gid";
process.env.GOOGLE_CLIENT_SECRET = "gsecret";
process.env.MICROSOFT_CLIENT_SECRET = "msecret";
process.env.CONNECTORS_ENC_KEY = "k".repeat(64);
process.env.BETTER_AUTH_SECRET = "segredo-de-teste-suficientemente-longo-000";

const cfg: Record<string, unknown> = { "connectors.microsoftTranscricoes": false, "meetings.importarMeet": false };
vi.mock("../settings", () => ({ settings: { get: async (k: string) => cfg[k] } }));

const gravado: Record<string, unknown>[] = [];
vi.mock("@orbita/db", () => ({ db: { update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void gravado.push(v) }) }) } }));

const { buildAuthorizeUrl, refreshConnectionToken } = await import("./store");
const { isConfigured } = await import("./registry");
const { decryptSecret } = await import("../crypto");

beforeEach(() => {
  gravado.length = 0;
});

describe("escopos opcionais", () => {
  it("Microsoft sem a opção: não pede a transcrição do Teams", async () => {
    const url = new URL(await buildAuthorizeUrl("microsoft", "st"));
    expect(url.searchParams.get("scope")).not.toContain("OnlineMeetingTranscript");
  });
  it("com a opção ligada, pede", async () => {
    cfg["connectors.microsoftTranscricoes"] = true;
    try {
      const escopos = new URL(await buildAuthorizeUrl("microsoft", "st")).searchParams.get("scope")!.split(" ");
      expect(escopos).toEqual(expect.arrayContaining(["Mail.ReadWrite", "User.Read", "OnlineMeetings.Read", "OnlineMeetingTranscript.Read.All"]));
    } finally {
      cfg["connectors.microsoftTranscricoes"] = false;
    }
  });
});

describe("escopo do Meet", () => {
  it("só é pedido quando o dono liga a importação do Meet (é fala de terceiros)", async () => {
    expect(new URL(await buildAuthorizeUrl("google", "st")).searchParams.get("scope")).not.toContain("meetings.space.readonly");
    cfg["meetings.importarMeet"] = true;
    try {
      expect(new URL(await buildAuthorizeUrl("google", "st")).searchParams.get("scope")).toContain("meetings.space.readonly");
    } finally {
      cfg["meetings.importarMeet"] = false;
    }
  });
});

describe("Zoom", () => {
  it("acende com as credenciais e não manda escopo no pedido (mora no app)", async () => {
    expect(isConfigured("zoom")).toBe(true);
    const url = new URL(await buildAuthorizeUrl("zoom", "st"));
    expect(url.origin + url.pathname).toBe("https://zoom.us/oauth/authorize");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("renovação: credenciais em Basic, e o refresh token NOVO é guardado", async () => {
    const fetchOriginal = globalThis.fetch;
    const chamada = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => Response.json({ access_token: "novo-access", refresh_token: "novo-refresh", expires_in: 3600 }));
    globalThis.fetch = chamada as typeof fetch;
    try {
      expect(await refreshConnectionToken("zoom", "u1", "velho-refresh", "c1")).toBe("novo-access");
    } finally {
      globalThis.fetch = fetchOriginal;
    }
    const headers = chamada.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("zid:zsecret").toString("base64")}`);
    expect(decryptSecret(gravado[0].refreshTokenEnc as string)).toBe("novo-refresh");
  });

  it("provedor que não troca o refresh token: o antigo fica como está", async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ access_token: "a", expires_in: 3600 })) as typeof fetch;
    try {
      await refreshConnectionToken("microsoft", "u1", "r", "c1");
    } finally {
      globalThis.fetch = fetchOriginal;
    }
    expect(gravado[0]).not.toHaveProperty("refreshTokenEnc");
    expect((gravado[0] as { accessTokenEnc: string }).accessTokenEnc).toBeTruthy();
  });
});
