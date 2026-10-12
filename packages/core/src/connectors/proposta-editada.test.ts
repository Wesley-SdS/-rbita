import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * APROVAR COM CORREÇÃO, sem abrir buraco no gate.
 *
 * A Órbita montava o evento e respondia "não consigo aprovar por você, abra o
 * painel Ações a confirmar". Certo pela regra (§5.1: só o POST /api/actions
 * executa) e ruim de usar: quem acabou de ditar o evento tinha de sair da
 * conversa para terminá-lo. O dono pediu poder ver como ficou, alterar e
 * confirmar ali mesmo.
 *
 * Alterar é da PESSOA, e é o gate funcionando: quem decide o conteúdo é ela, e
 * não o texto que o modelo leu. O que este arquivo trava é que a correção
 * continua passando pelo schema da tool antes de virar ação, para um campo
 * apagado sem querer virar recado e não falha depois do clique.
 */

const enviar_email = {
  name: "enviar_email",
  inputSchema: z.object({
    para: z.string().email(),
    assunto: z.string().min(1),
    corpo: z.string().min(1),
  }),
};

// schema ESTRITO: o `risco` que o registro grava no payload não pode recusar a proposta
const estrita = { name: "estrita", domain: "teste", risk: "efeito_externo", inputSchema: z.object({ x: z.string() }).strict(), run: vi.fn(async () => "rodou") };
const terminal = { name: "terminal_y", domain: "terminal", risk: "leitura", inputSchema: z.object({ comando: z.string() }), run: vi.fn(async () => "rodou no terminal") };
const ferramentas: Record<string, unknown> = { enviar_email, estrita, terminal_y: terminal };
vi.mock("../tools/index", () => ({
  getTool: (nome: string) => ferramentas[nome],
  isToolRisk: (v: unknown) => ["leitura", "escrita", "efeito_externo", "perigoso"].includes(v as string),
  maiorRisco: (a: string, b: string) => (["leitura", "escrita", "efeito_externo", "perigoso"].indexOf(b) > ["leitura", "escrita", "efeito_externo", "perigoso"].indexOf(a) ? b : a),
  riscoDaChamada: async (d: { risk: string }) => d.risk,
  loadToolOverrides: async () => new Map(),
}));
vi.mock("../mcp/client", () => ({ MCP_ACTION_KIND: "mcp_call", callMcpTool: vi.fn() }));
const executar = vi.fn(async (c: { run: () => Promise<unknown> }) => c.run());
vi.mock("../controle/guarda", () => ({ guardaDoControle: { executar: (c: { run: () => Promise<unknown> }) => executar(c) } }));

const { validarPropostaEditada, executeAction } = await import("./execute");

describe("o risco gravado na proposta (PRD-COMPUTADOR F1)", () => {
  it("sai antes de validar: schema estrito não recusa a proposta por causa dele", async () => {
    expect(validarPropostaEditada("estrita", { x: "a", risco: "perigoso" })).toEqual({ ok: true, dados: { x: "a" } });
    expect(await executeAction("u1", "estrita", { x: "a", risco: "efeito_externo" })).toBe("rodou");
    expect(estrita.run).toHaveBeenCalledWith({ x: "a" }, { userId: "u1" });
  });

  it("tool do controle do PC aprovada passa pela guarda, com o id da proposta e o risco gravado (nunca menor)", async () => {
    expect(await executeAction("u1", "terminal_y", { comando: "pnpm i", risco: "efeito_externo" }, "a7")).toBe("rodou no terminal");
    expect(executar).toHaveBeenCalledWith(expect.objectContaining({ acaoId: "a7", risco: "efeito_externo", entrada: { comando: "pnpm i" } }));
    // e o run recebe o id da aprovação no ctx (O4): é assim que controle_iniciar liga a sessão à aprovação
    expect(executar).toHaveBeenCalledWith(expect.objectContaining({ ctx: { userId: "u1", acaoId: "a7" } }));
  });
});

describe("validarPropostaEditada", () => {
  it("a correção válida passa, e é ela que vale", () => {
    const r = validarPropostaEditada("enviar_email", {
      para: "anna@exemplo.com",
      assunto: "Formação",
      corpo: "Combinado para as 13h.",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dados.assunto).toBe("Formação");
  });

  it("campo apagado vira recado com o NOME do campo", () => {
    // sem isto a pessoa clicava em confirmar e só então recebia "Proposta
    // inválida", sem saber o que consertar
    const r = validarPropostaEditada("enviar_email", { para: "anna@exemplo.com", assunto: "", corpo: "oi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("assunto");
  });

  it("e-mail malformado não vira ação", () => {
    const r = validarPropostaEditada("enviar_email", { para: "anna arroba exemplo", assunto: "x", corpo: "y" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("para");
  });

  it("ação desconhecida é recusada, não executada", () => {
    // o `kind` vem da linha da fila, mas a tool pode ter sido renomeada desde
    // que a proposta entrou
    const r = validarPropostaEditada("tool_que_nao_existe", { x: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/desconhecida/i);
  });

  it("tool de servidor MCP passa: quem valida o argumento é o servidor dela", () => {
    const r = validarPropostaEditada("mcp_call", { server: "casa", tool: "acender", args: {} });
    expect(r.ok).toBe(true);
  });

  it("MCP com payload que não é objeto é recusado", () => {
    expect(validarPropostaEditada("mcp_call", "acender a luz").ok).toBe(false);
    expect(validarPropostaEditada("mcp_call", null).ok).toBe(false);
  });

  it("campo a mais não derruba a aprovação, e não sobrevive", () => {
    // o schema da tool é a fronteira: o que ele não conhece não chega ao `run`
    const r = validarPropostaEditada("enviar_email", {
      para: "anna@exemplo.com",
      assunto: "x",
      corpo: "y",
      cc_secreto: "chefe@exemplo.com",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dados).not.toHaveProperty("cc_secreto");
  });
});

describe("recusa depois da aprovação vira falha, não 'Feito' (O1 da revisão)", () => {
  it("a guarda recusou a execução aprovada: executeAction LANÇA o motivo", async () => {
    executar.mockResolvedValueOnce({ permitido: false, erro: "O controle do PC está desligado em Ajustes (Controle do PC)." });
    await expect(executeAction("u1", "terminal_y", { comando: "git push", risco: "efeito_externo" }, "a8")).rejects.toThrow("O controle do PC está desligado");
    executar.mockResolvedValueOnce({ erro: "A tela mudou entre propor e executar: nada foi feito." });
    await expect(executeAction("u1", "terminal_y", { comando: "git push", risco: "efeito_externo" }, "a9")).rejects.toThrow("A tela mudou");
  });

  it("controle: a execução que deu certo continua voltando como resultado; tool comum com `erro` não muda", async () => {
    expect(await executeAction("u1", "terminal_y", { comando: "git status", risco: "efeito_externo" }, "a10")).toBe("rodou no terminal");
    estrita.run.mockResolvedValueOnce({ erro: "sem conexão" } as never);
    expect(await executeAction("u1", "estrita", { x: "a" })).toBe('{"erro":"sem conexão"}');
  });
});
