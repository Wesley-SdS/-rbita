import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NV.1, parte de RUNTIME (PRD §4.9): roda os fluxos reais de voz, ROSTO e
 * NARRAÇÃO com o banco simulado e o `fetch` interceptado, e falha se QUALQUER
 * requisição para host que não seja da casa carregar a amostra de áudio, a
 * imagem ou um vetor biométrico. O guard de saída fica instalado, como no
 * apps/api.
 *
 * A narração entra aqui porque o furo dela não é pegável por unidade: o modelo
 * de visão é resolvido lá dentro e sai pelo `fetch` do processo. Com
 * `localOnly` (câmera que identifica pessoas, decisão 9.6) nenhuma requisição
 * pode chegar à nuvem, MESMO com OPENAI_API_KEY configurada; sem identificação,
 * a nuvem continua permitida (é decisão do dono, não descuido).
 */

const MARCA_AUDIO = "AMOSTRA-BIOMETRICA-DE-TESTE-7f3a";
const MARCA_IMAGEM = "IMAGEM-BIOMETRICA-DE-TESTE-4c1d";
// a imagem viaja em base64 dentro do JSON do provedor: é a marca a procurar
const MARCA_IMAGEM_B64 = Buffer.from(MARCA_IMAGEM).toString("base64");
const SNAPSHOT = `data:image/jpeg;base64,${MARCA_IMAGEM_B64}`;
const VETOR = Array.from({ length: 8 }, (_, i) => 0.123456 + i / 1000);

// `encryptSecret` cifra a amostra de cadastro: sem chave, enrollFace nem roda
process.env.BETTER_AUTH_SECRET ??= "segredo-de-teste-para-cifrar-amostras";

// banco falso: qualquer cadeia de query resolve para as linhas configuradas
let linhas: Record<string, unknown[]> = {};
function cadeia(tabela = ""): unknown {
  const p = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => void) => ok(linhas[tabela] ?? []);
      // `from`/`insert`/`update`/`delete` dizem a tabela: o `returning()` de um
      // insert precisa devolver a linha certa (enrollFace usa o id da amostra)
      if (prop === "from" || prop === "insert" || prop === "update" || prop === "delete") return (t: { [k: symbol]: string }) => cadeia(nomeDe(t));
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
              "identity.faceBackend": "arcface",
              "identity.faceMatchThreshold": 0.75,
              "identity.faceProbableThreshold": 0.62,
              "identity.faceMargin": 0.08,
              "identity.faceMinSizePx": 60,
              "identity.presenceFreshMinutes": 5,
              "identity.presenceRecentMinutes": 60,
              "vision.localModel": "moondream",
              "vision.cloudModel": "gpt-4o",
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
import { enrollFace, identifyCameraEvent, identifyFace } from "../identity/face";
import { narrateSnapshot } from "../cameras/narrate";

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
    biometric_consent: [{ personId: pessoa.id, kinds: ["voz", "rosto"], grantedBy: "propria_pessoa", guardianPersonId: null, grantedAt: new Date(), revokedAt: null }],
    biometric_voice_embedding: [{ personId: pessoa.id, vector: VETOR }],
    biometric_unknown_voice: [],
    biometric_face_embedding: [{ personId: pessoa.id, vector: VETOR }],
    biometric_face_sample: [{ id: "22222222-2222-2222-2222-222222222222" }],
    biometric_unknown_face: [],
    camera_event: [{ id: "e1", userId: "dono", snapshot: SNAPSHOT, cameraId: "cam1", roomId: "quarto", identifica: true }],
    person_presence: [],
  };
  const inner = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    capturadas.push({ url, corpo: await corpoTexto(init?.body) });
    if (url.endsWith("/voice/embed")) return Response.json({ model: "wespeaker_resnet34", dim: 8, embedding: VETOR, durationS: 3, speechS: 2.5 });
    if (url.endsWith("/voice/embed-segments")) return Response.json({ model: "wespeaker_resnet34", dim: 8, segments: [{ start: 0, end: 3, speechS: 2.5, embedding: VETOR }] });
    if (url.endsWith("/face/embed")) return Response.json({ backend: "arcface", width: 640, height: 480, faces: [{ bbox: [0, 0, 120, 120], score: 0.99, size: 120, embedding: VETOR }] });
    // resposta de chat OpenAI-compatible: serve tanto para o Ollama local
    // quanto para a nuvem, então quem responde não muda o que o teste observa
    if (url.includes("/chat/completions")) {
      return Response.json({
        id: "cmpl-1",
        object: "chat.completion",
        created: 0,
        model: "fake",
        choices: [{ index: 0, message: { role: "assistant", content: "uma pessoa na cozinha" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    return new Response("{}");
  }) as typeof fetch;
  globalThis.fetch = guardFetch(inner);
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/**
 * Nenhuma requisição levando uma das marcas pode ter ido para fora de casa.
 * A lista é parametrizável porque a imagem da câmera só é biométrica quando a
 * câmera identifica pessoas: sem identificação, ela pode ir para a nuvem (9.6).
 */
function semVazamento(marcas: readonly string[] = [MARCA_AUDIO, MARCA_IMAGEM_B64, String(VETOR[3])]) {
  expect(capturadas.length).toBeGreaterThan(0);
  for (const c of capturadas) {
    const levaBiometria = marcas.some((m) => c.corpo.includes(m));
    if (levaBiometria) expect(isLocalUrl(c.url), `biometria enviada para ${c.url}`).toBe(true);
  }
}

const foiParaNuvem = () => capturadas.filter((c) => !isLocalUrl(c.url)).map((c) => c.url);

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

describe("NV.1 runtime: fluxos de rosto não mandam imagem nem vetor para fora de casa", () => {
  const foto = () => new TextEncoder().encode(MARCA_IMAGEM);

  it("cadastrar rosto por foto", async () => {
    const r = await enrollFace("dono", "11111111-1111-1111-1111-111111111111", foto(), "image/jpeg");
    expect(r.backend).toBe("arcface");
    semVazamento();
    expect(foiParaNuvem()).toEqual([]);
  });

  it("identificar um rosto", async () => {
    const r = await identifyFace("dono", foto(), "image/jpeg", { source: "tela" });
    expect(r?.outcome).toBe("identificado");
    expect(r?.name).toBe("Wesley");
    semVazamento();
    expect(foiParaNuvem()).toEqual([]);
  });

  it("identificar quem apareceu num evento de câmera (com presença e desconhecido)", async () => {
    const r = await identifyCameraEvent("e1");
    expect(r?.outcome).toBe("identificado");
    semVazamento();
    expect(foiParaNuvem()).toEqual([]);
  });

  it("se alguém apontar a percepção para a nuvem, a foto não chega a ser montada", async () => {
    const { settings } = await import("../settings");
    const original = settings.getMany;
    (settings as { getMany: typeof original }).getMany = (async (keys: string[]) => {
      const v = await original(keys);
      return { ...v, "identity.perceptionUrl": "https://perception.exemplo-nuvem.com" };
    }) as typeof original;
    try {
      await expect(identifyFace("dono", foto(), "image/jpeg", { source: "tela" })).rejects.toThrow();
      expect(capturadas.filter((c) => c.corpo.includes(MARCA_IMAGEM))).toEqual([]);
    } finally {
      (settings as { getMany: typeof original }).getMany = original;
    }
  });
});

/**
 * Este é o bloco que teria pego o furo: `localOnly` não é uma opção passada
 * adiante, é uma barreira de rede. Com chave de nuvem configurada, a narração
 * de câmera que identifica pessoas não pode gerar UMA requisição sequer para
 * fora de casa.
 */
describe("NV.1 runtime: narração de câmera respeita a decisão 9.6", () => {
  const comChaveDaNuvem = async (fn: () => Promise<unknown>) => {
    const antes = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-chave-de-teste";
    try {
      return await fn();
    } finally {
      if (antes === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = antes;
    }
  };

  it("câmera que identifica pessoas: nada vai para a nuvem, mesmo com OPENAI_API_KEY", async () => {
    const texto = (await comChaveDaNuvem(() => narrateSnapshot(SNAPSHOT, undefined, { localOnly: true }))) as string;
    expect(texto).toBe("uma pessoa na cozinha");
    semVazamento();
    expect(foiParaNuvem()).toEqual([]);
    expect(capturadas.some((c) => c.url.includes("api.openai.com"))).toBe(false);
    // e a imagem realmente saiu daqui: o teste não passou por não ter chamado nada
    expect(capturadas.some((c) => c.corpo.includes(MARCA_IMAGEM_B64))).toBe(true);
  });

  it("câmera sem identificação: a nuvem continua permitida (decisão do dono)", async () => {
    await comChaveDaNuvem(() => narrateSnapshot(SNAPSHOT, undefined, { localOnly: false }));
    expect(capturadas.some((c) => c.url.startsWith("https://api.openai.com/"))).toBe(true);
    // imagem de câmera sem identificação não é biometria; voz e vetor continuam presos em casa
    semVazamento([MARCA_AUDIO, String(VETOR[3])]);
  });

  it("sem chave de nuvem, a narração cai no modelo local de qualquer jeito", async () => {
    const antes = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await narrateSnapshot(SNAPSHOT, undefined, {});
      expect(foiParaNuvem()).toEqual([]);
    } finally {
      if (antes !== undefined) process.env.OPENAI_API_KEY = antes;
    }
  });
});
