import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverModels, discoveredSnapshot, invalidateDiscovery, discoveryAgeMs, versaoDe, EMPTY_DISCOVERY_RETRY_MS, descobrirLocalSobDemanda } from "./discovery";
import { resetModelPolicyForTests } from "./policy";

// o catálogo do AI Gateway que NUNCA responde (só entra quando o teste põe a chave)
vi.mock("@ai-sdk/gateway", () => ({ createGateway: () => ({ getAvailableModels: () => new Promise(() => undefined) }) }));

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
  // estes testes simulam o Ollama: a descoberta precisa perguntar a ele
  resetModelPolicyForTests({ descobrirLocal: "sempre" });
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

  it("provedor que nunca responde não segura a descoberta (a tela de Conversas pendurou assim)", async () => {
    resetModelPolicyForTests({ descobrirLocal: "sempre", discoveryTimeoutMs: 50 });
    process.env.AI_GATEWAY_API_KEY = "chave";
    vi.stubGlobal("fetch", ollamaCom(["qwen2.5:3b"]));
    const inicio = Date.now();
    const lista = await discoverModels();
    expect(lista.map((m) => m.key)).toEqual(["local/qwen2.5:3b"]);
    expect(Date.now() - inicio).toBeLessThan(3000);
  });

  it("Ollama fora do ar não derruba a descoberta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await discoverModels()).toEqual([]);
  });

  it("cache vencido devolve a lista antiga na hora e renova em segundo plano (RV.3)", async () => {
    resetModelPolicyForTests({ discoveryTtlMs: 1000, descobrirLocal: "sempre" });
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

describe("descoberta: o Ollama só é perguntado quando o local pode ser escolhido (E3)", () => {
  it("dono em assinatura, descobrir em auto: nenhuma ida ao :11434", async () => {
    resetModelPolicyForTests({ descobrirLocal: "auto", failoverOrder: "assinatura_paga_local" });
    const f = ollamaCom(["qwen2.5:3b"]);
    vi.stubGlobal("fetch", f);
    expect(await discoverModels()).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("ordem com o local antes da nuvem paga continua perguntando", async () => {
    resetModelPolicyForTests({ descobrirLocal: "auto", failoverOrder: "assinatura_local_paga" });
    vi.stubGlobal("fetch", ollamaCom(["qwen2.5:3b"]));
    expect((await discoverModels()).map((m) => m.key)).toEqual(["local/qwen2.5:3b"]);
  });

  it("modo privacidade pergunta na hora mesmo em auto, mas não em nunca", async () => {
    resetModelPolicyForTests({ descobrirLocal: "auto", failoverOrder: "assinatura_paga_local" });
    vi.stubGlobal("fetch", ollamaCom(["qwen2.5:3b"]));
    expect((await descobrirLocalSobDemanda()).map((m) => m.key)).toEqual(["local/qwen2.5:3b"]);
    // e não suja o cache: a cadeia normal continua sem o local
    expect(discoveredSnapshot()).toEqual([]);

    resetModelPolicyForTests({ descobrirLocal: "nunca" });
    expect(await descobrirLocalSobDemanda()).toEqual([]);
  });
});

describe("versão embutida no id", () => {
  it("extrai números na ordem", () => {
    expect(versaoDe("claude-opus-4-8")).toEqual([4, 8]);
    expect(versaoDe("gemini-3.5-flash")).toEqual([3.5]);
    expect(versaoDe("sem-numero")).toEqual([]);
  });
});
