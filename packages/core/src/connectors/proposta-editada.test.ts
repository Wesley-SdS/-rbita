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

vi.mock("../tools/index", () => ({
  getTool: (nome: string) => (nome === "enviar_email" ? enviar_email : undefined),
}));
vi.mock("../mcp/client", () => ({ MCP_ACTION_KIND: "mcp_call", callMcpTool: vi.fn() }));

const { validarPropostaEditada } = await import("./execute");

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
