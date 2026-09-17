import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NV.1, parte de RUNTIME (PRD §4.9): roda os fluxos reais de voz com o banco
 * simulado e o `fetch` interceptado, e falha se QUALQUER requisição para host
 * que não seja da casa carregar a amostra de áudio ou um vetor biométrico.
 * O guard de saída fica instalado, como no apps/api.
 */

const MARCA_AUDIO = "AMOSTRA-BIOMETRICA-DE-TESTE-7f3a";
const VETOR = Array.from({ length: 8 }, (_, i) => 0.123456 + i / 1000);

// banco falso: qualquer cadeia de query resolve para as linhas configuradas
let linhas: Record<string, unknown[]> = {};
function cadeia(tabela = ""): unknown {
  const p = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => void) => ok(linhas[tabela] ?? []);
      if (prop === "from") return (t: { [k: symbol]: string }) => cadeia(nomeDe(t));
      if (prop === "transaction") return async (fn: (tx: unknown) => Promise<unknown>) => fn(cadeia());
      return (..._args: unknown[]) => cadeia(tabela);
    },
    apply: () => cadeia(tabela),
  });
  return p;
}
function nomeDe(t: unknown): string {
  const s = Object.getOwnPropertySymbols(t as object).find((x) => String(x) === "Symbol(drizzle:Name)");
  return s ? String((t as Record<symbol, unknown>)[s]) : "";
}
vi.mock("@orbita/db", () => ({ db: cadeia() }));
vi.mock("../settings", () => ({
  settings: {
    getMany: async (keys: string[]) =>
      Object.fromEntries(
        keys.map((k) => [
          k,
          (
            {
              "identity.perceptionUrl": "http://127.0.0.1:8002",
              "identity.perceptionTimeoutMs": 5000,
              "identity.voiceModel": "wespeaker_resnet34",
              "identity.voiceMatchThreshold": 0.75,
              "identity.voiceProbableThreshold": 0.62,
              "identity.voiceMargin": 0.08,
              "identity.voiceMinSpeechSeconds": 1,
              "identity.meetingSpeakerMaxSeconds": 40,
              "identity.unknownRetentionDays": 7,
              "identity.voiceEnrollMinSeconds": 5,
            } as Record<string, unknown>
          )[k],
        ]),
      ),
    get: async () => 7,
  },
}));
vi.mock("../events/index", () => ({ events: { emit: async () => undefined } }));

import { guardFetch, isLocalUrl } from "./egress";
import { identifyMeetingSpeakers, identifyVoice } from "../identity/voice";

interface Capturada {
  url: string;
  corpo: string;
}
let capturadas: Capturada[] = [];
const fetchOriginal = globalThis.fetch;

async function corpoTexto(body: unknown): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof FormData) {
    let s = "";
    for (const [k, v] of body.entries()) s += k + "=" + (typeof v === "string" ? v : Buffer.from(await v.arrayBuffer()).toString("latin1")) + "&";
    return s;
  }
  return String(body);
}

beforeEach(() => {
  capturadas = [];
  const pessoa = { id: "11111111-1111-1111-1111-111111111111", userId: "dono", name: "Wesley", role: "dono", relation: "morador", isMinor: false, guardianPersonId: null };
  linhas = {
    person: [pessoa],
    biometric_consent: [{ personId: pessoa.id, kinds: ["voz"], grantedBy: "propria_pessoa", guardianPersonId: null, grantedAt: new Date(), revokedAt: null }],
    biometric_voice_embedding: [{ personId: pessoa.id, vector: VETOR }],
    biometric_unknown_voice: [],
  };
  const inner = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    capturadas.push({ url, corpo: await corpoTexto(init?.body) });
    if (url.endsWith("/voice/embed")) return Response.json({ model: "wespeaker_resnet34", dim: 8, embedding: VETOR, durationS: 3, speechS: 2.5 });
    if (url.endsWith("/voice/embed-segments")) return Response.json({ model: "wespeaker_resnet34", dim: 8, segments: [{ start: 0, end: 3, speechS: 2.5, embedding: VETOR }] });
    return new Response("{}");
  }) as typeof fetch;
  globalThis.fetch = guardFetch(inner);
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

function semVazamento() {
  expect(capturadas.length).toBeGreaterThan(0);
  const vetorTexto = String(VETOR[3]);
  for (const c of capturadas) {
    const levaBiometria = c.corpo.includes(MARCA_AUDIO) || c.corpo.includes(vetorTexto);
    if (levaBiometria) expect(isLocalUrl(c.url), `biometria enviada para ${c.url}`).toBe(true);
  }
}

describe("NV.1 runtime: fluxos de voz não mandam biometria para fora de casa", () => {
  it("identificar quem pediu", async () => {
    const r = await identifyVoice("dono", new TextEncoder().encode(MARCA_AUDIO), "audio/webm");
    expect(r.outcome).toBe("identificado");
    semVazamento();
    expect(capturadas.every((c) => isLocalUrl(c.url))).toBe(true);
  });

  it("nomes dos locutores de uma reunião", async () => {
    const r = await identifyMeetingSpeakers("dono", new TextEncoder().encode(MARCA_AUDIO), "audio/webm", [{ speaker: "A", startMs: 0, endMs: 3000 }], null);
    expect(r[0]?.name).toBe("Wesley");
    semVazamento();
  });

  it("se alguém apontar a percepção para a nuvem, o cliente recusa antes de montar a requisição", async () => {
    const { settings } = await import("../settings");
    const original = settings.getMany;
    (settings as { getMany: typeof original }).getMany = (async (keys: string[]) => {
      const v = await original(keys);
      return { ...v, "identity.perceptionUrl": "https://perception.exemplo-nuvem.com" };
    }) as typeof original;
    try {
      await expect(identifyVoice("dono", new TextEncoder().encode(MARCA_AUDIO), "audio/webm")).rejects.toThrow();
      expect(capturadas.filter((c) => c.corpo.includes(MARCA_AUDIO))).toEqual([]);
    } finally {
      (settings as { getMany: typeof original }).getMany = original;
    }
  });
});
