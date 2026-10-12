import { afterEach, describe, expect, it } from "vitest";
import { chamarClaudeDireto, corpoClaudeDireto, ErroClaudeDireto, IDENTIDADE_CLAUDE_CODE, idDoModeloClaude } from "./claude-direto";

/** O caminho direto da assinatura (toolsets de computer e browser use): cabeçalhos OAuth e a identidade no 1º bloco. */

const antes = process.env.CLAUDE_CODE_OAUTH_TOKEN;
afterEach(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = antes;
});

describe("chamarClaudeDireto", () => {
  it("o 1º bloco de system é EXATAMENTE a identidade do Claude Code, sem repetir", () => {
    const c = corpoClaudeDireto({ modelo: "claude/claude-sonnet-5-5", system: `${IDENTIDADE_CLAUDE_CODE}\nObjetivo: x`, mensagens: [{ role: "user", content: "oi" }], tools: [{ type: "browser_toolset_20260801" }], maxTokens: 100 });
    expect(c.model).toBe("claude-sonnet-5-5");
    expect(c.system).toEqual([{ type: "text", text: IDENTIDADE_CLAUDE_CODE }, { type: "text", text: "Objetivo: x" }]);
    expect(c.tools).toEqual([{ type: "browser_toolset_20260801" }]);
    expect(idDoModeloClaude("claude-opus-5-5")).toBe("claude-opus-5-5");
  });

  it("cachearPrefixo marca só o ÚLTIMO bloco de system (o prefixo estável: toolset + system)", () => {
    const base = { modelo: "claude-sonnet-5-5", system: "Objetivo: x", mensagens: [{ role: "user" as const, content: "oi" }], tools: [{ type: "computer_toolset_20260801" }], maxTokens: 10 };
    const sem = corpoClaudeDireto(base);
    const com = corpoClaudeDireto({ ...base, cachearPrefixo: true });
    expect(JSON.stringify(sem.system)).not.toContain("cache_control");
    expect(com.system).toEqual([{ type: "text", text: IDENTIDADE_CLAUDE_CODE }, { type: "text", text: "Objetivo: x", cache_control: { type: "ephemeral" } }]);
    // só a identidade (system vazio): ela mesma leva a marca
    expect(corpoClaudeDireto({ ...base, system: "", cachearPrefixo: true }).system).toEqual([{ type: "text", text: IDENTIDADE_CLAUDE_CODE, cache_control: { type: "ephemeral" } }]);
  });

  it("Bearer, beta OAuth primeiro, sem x-api-key; erro vira ErroClaudeDireto com o status", async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "tok-teste";
    let visto: { headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const ok = await chamarClaudeDireto({
      modelo: "claude-sonnet-5-5",
      system: "x",
      mensagens: [{ role: "user", content: "oi" }],
      maxTokens: 10,
      betas: ["algum-beta"],
      fetchImpl: (async (_u: string, init: RequestInit) => {
        visto = { headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ content: [{ type: "text", text: "olá" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 2 } }));
      }) as typeof fetch,
    });
    expect(ok).toMatchObject({ stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 2 } });
    expect(visto!.headers).toMatchObject({ authorization: "Bearer tok-teste", "anthropic-beta": "oauth-2025-04-20,algum-beta" });
    expect(visto!.headers).not.toHaveProperty("x-api-key");
    await expect(
      chamarClaudeDireto({ modelo: "x", system: "", mensagens: [], maxTokens: 1, fetchImpl: (async () => new Response("recusado", { status: 400 })) as typeof fetch }),
    ).rejects.toBeInstanceOf(ErroClaudeDireto);
  });

  it("I-7: a chamada tem teto; o Parar do dono corta antes do teto, e é o erro dele que sobe", async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "tok-teste";
    // um fetch que só termina quando o sinal manda (como uma resposta que nunca chega)
    const travado = (async (_u: string, init: RequestInit) =>
      new Promise<Response>((_, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))))) as typeof fetch;
    const inicio = Date.now();
    await expect(chamarClaudeDireto({ modelo: "x", system: "", mensagens: [], maxTokens: 1, timeoutMs: 80, fetchImpl: travado })).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/sem resposta em/) });
    expect(Date.now() - inicio).toBeLessThan(2000);
    const parar = new AbortController();
    setTimeout(() => parar.abort(), 20);
    await expect(chamarClaudeDireto({ modelo: "x", system: "", mensagens: [], maxTokens: 1, timeoutMs: 60_000, signal: parar.signal, fetchImpl: travado })).rejects.toMatchObject({ name: "AbortError" });
    // o teto e o tempo de leitura não vão para o corpo da API
    expect(corpoClaudeDireto({ modelo: "x", system: "", mensagens: [], maxTokens: 1, timeoutMs: 5 } as never)).not.toHaveProperty("timeoutMs");
  });

  it("sem token, nem tenta", async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    await expect(chamarClaudeDireto({ modelo: "x", system: "", mensagens: [], maxTokens: 1 })).rejects.toThrow(/não configurado/);
  });
});
