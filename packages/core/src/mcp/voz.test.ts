import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MCP na voz: duas funções em vez de 85. A busca acha pelo assunto; o uso passa
 * pelo MESMO executor do chat (risco e aprovação), com a proposta no canal
 * "voz", para o "manda" falado achá-la.
 */

type F = { chave: string; servidor: string; tool: string; descricao: string; inputSchema: unknown; risco: string };
let ferramentas: F[] = [];
const executar = vi.fn(async (..._a: unknown[]): Promise<unknown> => [{ type: "text", text: '{"total":51}' }]);

vi.mock("./client", () => ({
  ferramentasMcpDoDono: async () => ferramentas,
  executarFerramentaMcp: (...a: unknown[]) => executar(...a),
  escolherFerramentasMcp: (fs: F[], pedido: string, max: number, _porRelevancia?: boolean) => fs.filter((f) => f.descricao.toLowerCase().includes(pedido.split(" ")[0]!.toLowerCase())).slice(0, max),
}));

const { funcoesMcpDeVoz, executarFuncaoMcpDeVoz, ehFuncaoMcpDeVoz } = await import("./voz");

beforeEach(() => {
  executar.mockClear();
  ferramentas = [
    { chave: "tickets__tickets_list", servidor: "tickets", tool: "tickets_list", descricao: "Lista chamados", inputSchema: { type: "object" }, risco: "leitura" },
    { chave: "tickets__tickets_create", servidor: "tickets", tool: "tickets_create", descricao: "Abre um chamado", inputSchema: { type: "object" }, risco: "efeito_externo" },
  ];
});

describe("MCP na voz", () => {
  it("sem servidor ligado, a voz não ganha função nenhuma; com servidor, ganha duas", async () => {
    ferramentas = [];
    expect(await funcoesMcpDeVoz("dono")).toEqual([]);
    ferramentas = [{ chave: "tickets__tickets_list", servidor: "tickets", tool: "tickets_list", descricao: "Lista chamados", inputSchema: {}, risco: "leitura" }];
    const fs = await funcoesMcpDeVoz("dono");
    expect(fs.map((f) => f.name)).toEqual(["buscar_ferramenta_externa", "usar_ferramenta_externa"]);
    expect(fs[0]!.description).toContain("tickets");
    expect(fs.every((f) => ehFuncaoMcpDeVoz(f.name))).toBe(true);
  });

  it("a busca devolve nome, parâmetros e se pede aprovação", async () => {
    const r = (await executarFuncaoMcpDeVoz("dono", "buscar_ferramenta_externa", { busca: "abre um chamado" })) as { ferramentas: { nome: string; pede_aprovacao: boolean }[] };
    expect(r.ferramentas).toEqual([expect.objectContaining({ nome: "tickets__tickets_create", pede_aprovacao: true })]);
  });

  it("usar passa os argumentos ao executor do chat, no canal voz, e devolve o texto para o modelo ler", async () => {
    const r = await executarFuncaoMcpDeVoz("dono", "usar_ferramenta_externa", { ferramenta: "tickets__tickets_list", argumentos_json: '{"status":"open"}' });
    expect(executar).toHaveBeenCalledWith("dono", expect.objectContaining({ chave: "tickets__tickets_list" }), { status: "open" }, "voz");
    expect(r).toEqual({ ferramenta: "tickets__tickets_list", descricao: "Lista chamados", resultado: '{"total":51}' });
  });

  it("ferramenta inventada e JSON torto respondem o motivo sem chamar nada", async () => {
    expect(await executarFuncaoMcpDeVoz("dono", "usar_ferramenta_externa", { ferramenta: "tickets__apagar_tudo" })).toMatchObject({ erro: expect.stringContaining("não existe") });
    expect(await executarFuncaoMcpDeVoz("dono", "usar_ferramenta_externa", { ferramenta: "tickets__tickets_list", argumentos_json: "{status:" })).toMatchObject({ erro: expect.stringContaining("JSON") });
    expect(await executarFuncaoMcpDeVoz("dono", "usar_ferramenta_externa", { ferramenta: "tickets__tickets_list", argumentos_json: "[1]" })).toMatchObject({ erro: expect.stringContaining("objeto") });
    expect(executar).not.toHaveBeenCalled();
  });
});
