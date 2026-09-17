import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverModels, discoveredSnapshot, invalidateDiscovery, discoveryAgeMs, versaoDe, EMPTY_DISCOVERY_RETRY_MS } from "./discovery";
import { resetModelPolicyForTests } from "./policy";

/**
 * Descoberta com fetch simulado: só o Ollama responde (as chaves de nuvem saem
 * do ambiente durante o teste), para não depender da máquina.
 */
const NUVEM = ["CLAUDE_CODE_OAUTH_TOKEN", "AI_GATEWAY_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "COHERE_API_KEY"];
const salvo: Record<string, string | undefined> = {};

function ollamaCom(nomes: string[]) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        models: [
          ...nomes.map((name) => ({ name, details: { parameter_size: "3.1B", context_length: 32768 }, capabilities: ["completion", "tools"] })),
          { name: "nomic-embed-text", details: { parameter_size: "137M" }, capabilities: ["embedding"] },
        ],
      }),
      { status: 200 },
    ),
  );
}

beforeEach(() => {
  for (const k of NUVEM) {
    salvo[k] = process.env[k];
    delete process.env[k];
  }
  invalidateDiscovery();
  resetModelPolicyForTests();
});

afterEach(() => {
  for (const k of NUVEM) if (salvo[k] !== undefined) process.env[k] = salvo[k];
  vi.unstubAllGlobals();
  vi.useRealTimers();
  invalidateDiscovery();
});

describe("descoberta de modelos", () => {
  it("lista os modelos de conversa do Ollama e ignora embedding", async () => {
    vi.stubGlobal("fetch", ollamaCom(["qwen2.5:3b"]));
    const lista = await discoverModels();
    expect(lista.map((m) => m.key)).toEqual(["local/qwen2.5:3b"]);
    expect(lista[0]).toMatchObject({ local: true, tier: "small", supportsTools: true, paramsB: 3.1 });
  });

  it("Ollama fora do ar não derruba a descoberta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await discoverModels()).toEqual([]);
  });

  it("cache vencido devolve a lista antiga na hora e renova em segundo plano (RV.3)", async () => {
    resetModelPolicyForTests({ discoveryTtlMs: 1000 });
    vi.stubGlobal("fetch", ollamaCom(["qwen2.5:3b"]));
    await discoverModels();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5000);
    let liberar!: () => void;
    const segundo = ollamaCom(["qwen2.5:3b", "llama3.2:1b"]);
    const lento = vi.fn(async () => {
      await new Promise<void>((r) => { liberar = r; });
      return segundo();
    });
    vi.stubGlobal("fetch", lento);

    // não espera a rede: devolve o snapshot antigo
    const agora = await discoverModels();
    expect(agora.map((m) => m.key)).toEqual(["local/qwen2.5:3b"]);
    expect(lento).toHaveBeenCalledTimes(1);

    liberar();
    await vi.waitFor(() => expect(discoveredSnapshot()).toHaveLength(2));
    expect(discoveryAgeMs()).toBeLessThan(1000);
  });

  it("chamadas simultâneas compartilham uma ida à rede", async () => {
    const f = ollamaCom(["qwen2.5:3b"]);
    vi.stubGlobal("fetch", f);
    await Promise.all([discoverModels(), discoverModels(), discoverModels()]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("force ignora o cache válido", async () => {
    const f = ollamaCom(["qwen2.5:3b"]);
    vi.stubGlobal("fetch", f);
    await discoverModels();
    await discoverModels({ force: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("descoberta: bordas da revisão", () => {
  it("lista vazia não vale um TTL inteiro: tenta de novo em segundos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ollama subindo"); }));
    await discoverModels();
    expect(discoveryAgeMs()).toBe(Infinity);

    const f = ollamaCom(["qwen2.5:3b"]);
    vi.stubGlobal("fetch", f);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + EMPTY_DISCOVERY_RETRY_MS + 1);
    await discoverModels();
    await vi.waitFor(() => expect(discoveredSnapshot()).toHaveLength(1));
  });

  it("descoberta antiga não grava por cima de uma invalidação mais nova", async () => {
    let liberar!: () => void;
    const velha = ollamaCom(["modelo-velho:1b"]);
    const lento = vi.fn(async () => {
      await new Promise<void>((r) => { liberar = r; });
      return velha();
    });
    vi.stubGlobal("fetch", lento);
    const emVoo = discoverModels();
    // só invalida depois que a descoberta antiga já está na rede
    await vi.waitFor(() => expect(lento).toHaveBeenCalled());

    invalidateDiscovery();
    vi.stubGlobal("fetch", ollamaCom(["modelo-novo:3b"]));
    await discoverModels({ force: true });

    liberar();
    await emVoo;
    expect(discoveredSnapshot().map((m) => m.key)).toEqual(["local/modelo-novo:3b"]);
  });
});

describe("versão embutida no id", () => {
  it("extrai números na ordem", () => {
    expect(versaoDe("claude-opus-4-8")).toEqual([4, 8]);
    expect(versaoDe("gemini-3.5-flash")).toEqual([3.5]);
    expect(versaoDe("sem-numero")).toEqual([]);
  });
});
