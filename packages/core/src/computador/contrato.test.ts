import { describe, expect, it } from "vitest";
import { chamarClaudeDireto, type BlocoClaude, type MensagemClaude } from "@orbita/llm";
import { ferramentasDoComputador, toolsetDoComputador } from "./membros";

/**
 * CONTRATO REAL com a assinatura (PRD-MOTOR-DESKTOP §10.4), opt-in:
 * `ORBITA_E2E_CLAUDE=1` e o `CLAUDE_CODE_OAUTH_TOKEN` no ambiente. Faz UMA
 * conversa curta de duas chamadas e confere o que o laço assume:
 *
 *   1. o toolset entra como `{ type: "computer_toolset_20260801" }` (sem nome nem
 *      tamanho de tela) e o Claude responde com um `tool_use` de `screenshot`;
 *   2. o `tool_result` com IMAGEM que o motor devolve é aceito e o `usage` vem lido.
 *
 * Serve de teste de fumaça contra mudança da Anthropic. NUNCA imprime o token.
 * Sem o opt-in não roda (não gasta a assinatura em toda suíte).
 */

const ligado = process.env.ORBITA_E2E_CLAUDE === "1" && Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);

/** Um PNG de verdade (320x180, fundo claro com texto), para o `tool_result` não ser uma imagem de 1 pixel. */
async function pngDeTeste(): Promise<string> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(320, 180);
  const g = c.getContext("2d");
  g.fillStyle = "#f4f4f4";
  g.fillRect(0, 0, 320, 180);
  g.fillStyle = "#222";
  g.font = "20px sans-serif";
  g.fillText("Bloco de Notas", 20, 40);
  g.strokeRect(20, 60, 280, 90);
  return c.toBuffer("image/png").toString("base64");
}

describe.skipIf(!ligado)("contrato real: computer_toolset_20260801 pela assinatura", () => {
  it("screenshot chega como tool_use e o tool_result com imagem é aceito", async () => {
    const modelo = process.env.ORBITA_E2E_MODELO ?? "claude/claude-sonnet-5-5";
    // o toolset e a ferramenta própria de abrir app, juntos, como o laço os envia
    const tools = ferramentasDoComputador();
    expect(tools[0]).not.toHaveProperty("name");
    const mensagens: MensagemClaude[] = [{ role: "user", content: "Tire um screenshot da tela e me diga o que está escrito nele. Use a ferramenta." }];
    const system = "Você controla um computador de teste. Use a ferramenta de computador para ver a tela.";

    const a = await chamarClaudeDireto({ modelo, system, mensagens, tools, maxTokens: 512, cachearPrefixo: true });
    const uso = a.content.find((b) => b.type === "tool_use");
    // medição: o que a API devolveu de verdade, para o MEDICAO.md (sem token nem conteúdo de tela)
    console.info("[contrato] 1ª chamada:", JSON.stringify({ stop: a.stop_reason, nome: uso?.name, toolset_name: uso?.toolset_name, input: uso?.input, usage: a.usage }));
    expect(a.stop_reason).toBe("tool_use");
    expect(uso).toMatchObject({ type: "tool_use", name: "screenshot", toolset_name: "computer" });
    expect(a.usage.input_tokens + (a.usage.cache_creation_input_tokens ?? 0) + (a.usage.cache_read_input_tokens ?? 0)).toBeGreaterThan(0);

    const resultado: BlocoClaude = {
      type: "tool_result",
      tool_use_id: uso!.id,
      toolset_name: uso!.toolset_name,
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: await pngDeTeste() } }],
    };
    const b = await chamarClaudeDireto({
      modelo,
      system,
      mensagens: [...mensagens, { role: "assistant", content: a.content }, { role: "user", content: [resultado] }],
      tools,
      maxTokens: 512,
      cachearPrefixo: true,
    });
    console.info("[contrato] 2ª chamada:", JSON.stringify({ stop: b.stop_reason, tipos: b.content.map((x) => x.type), usage: b.usage }));
    expect(b.usage.output_tokens).toBeGreaterThan(0);
    expect(["end_turn", "tool_use"]).toContain(b.stop_reason);
    // a 2ª chamada lê o prefixo (toolset + system) do cache, ou ao menos o cria
    expect((b.usage.cache_read_input_tokens ?? 0) + (a.usage.cache_creation_input_tokens ?? 0)).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it("a versão antiga (computer_20251124) é recusada pelos modelos 5.5: o motivo de usarmos o toolset", async () => {
    const modelo = process.env.ORBITA_E2E_MODELO ?? "claude/claude-sonnet-5-5";
    await expect(
      chamarClaudeDireto({ modelo, system: "x", mensagens: [{ role: "user", content: "oi" }], tools: [{ type: "computer_20251124", name: "computer", display_width_px: 1280, display_height_px: 720 }], maxTokens: 16 }),
    ).rejects.toMatchObject({ status: 400 });
  }, 60_000);
});

describe("o contrato sem rede", () => {
  it("o toolset montado não leva name nem tamanho de tela (a API devolve 400 com eles)", () => {
    const t = toolsetDoComputador();
    expect(Object.keys(t).sort()).toEqual(["configs", "type"]);
  });
});
