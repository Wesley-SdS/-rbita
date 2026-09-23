import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A regra da multi-conta: leitura varre tudo, escrita escolhe uma.
 *
 * O que este arquivo trava é a parte perigosa: escolher a conta errada para
 * ESCREVER. Mandar o e-mail do trabalho pela conta pessoal não dá para
 * desfazer, então ambiguidade tem de virar pergunta, nunca palpite.
 */

interface ConexaoFalsa {
  id: string;
  accountLabel: string | null;
  provider?: string;
  userId?: string;
}

let contas: ConexaoFalsa[] = [];
let tokens: { conexao: ConexaoFalsa; token: string }[] = [];

vi.mock("./store", () => ({
  listarContas: async () => contas,
  tokenDaConexao: async (c: ConexaoFalsa) => `token-de-${c.id}`,
  tokensDeTodasAsContas: async () => tokens,
}));

const { escolherConta, contaParaEscrever, lerDeTodasAsContas } = await import("./multi");

const c = (id: string, accountLabel: string | null): ConexaoFalsa => ({ id, accountLabel, provider: "google", userId: "u1" });

beforeEach(() => {
  contas = [];
  tokens = [];
});

describe("qual conta o dono quis dizer", () => {
  const duas = [c("id-1", "wesley@gmail.com"), c("id-2", "wesley@empresa.com.br")];

  it("casa por pedaço do rótulo, que é como a pessoa fala", () => {
    expect(escolherConta(duas, "empresa")?.id).toBe("id-2");
    expect(escolherConta(duas, "gmail")?.id).toBe("id-1");
  });

  it("acento e caixa não atrapalham", () => {
    const comAcento = [c("a", "Conta Pessoal"), c("b", "Trabalho")];
    expect(escolherConta(comAcento, "pessoal")?.id).toBe("a");
    expect(escolherConta(comAcento, "PESSOAL")?.id).toBe("a");
  });

  it("id exato ganha de tudo", () => {
    expect(escolherConta(duas, "id-2")?.id).toBe("id-2");
  });

  it("AMBÍGUO não escolhe: duas contas casando vira pergunta", () => {
    // "wesley" casa com as duas. Chutar a primeira mandaria o e-mail pela
    // conta errada, e isso não se desfaz.
    expect(escolherConta(duas, "wesley")).toBeNull();
  });

  it("pedido que não casa com nada também não escolhe", () => {
    expect(escolherConta(duas, "faculdade")).toBeNull();
  });

  it("sem pedido não escolhe (quem chama cai na principal)", () => {
    expect(escolherConta(duas, undefined)).toBeNull();
    expect(escolherConta(duas, "   ")).toBeNull();
  });

  it("conta sem rótulo não casa por texto, mas casa por id", () => {
    const sem = [c("x", null)];
    expect(escolherConta(sem, "qualquer")).toBeNull();
    expect(escolherConta(sem, "x")?.id).toBe("x");
  });
});

describe("a conta que vai escrever", () => {
  it("sem conta nenhuma, diz isso em vez de quebrar", async () => {
    const r = await contaParaEscrever("google", "u1");
    expect(r).toMatchObject({ erro: expect.stringContaining("Nenhuma conta") });
  });

  it("com uma conta só, nem pergunta", async () => {
    contas = [c("id-1", "wesley@gmail.com")];
    const r = await contaParaEscrever("google", "u1", "qualquer coisa");
    expect(r).toMatchObject({ token: "token-de-id-1", rotulo: "wesley@gmail.com" });
  });

  it("sem pedido, a principal (a primeira da lista)", async () => {
    contas = [c("id-1", "pessoal"), c("id-2", "trabalho")];
    const r = await contaParaEscrever("google", "u1");
    expect(r).toMatchObject({ token: "token-de-id-1" });
  });

  it("pedido ambíguo com várias contas PERGUNTA, não chuta", async () => {
    contas = [c("id-1", "wesley@gmail.com"), c("id-2", "wesley@empresa.com")];
    const r = await contaParaEscrever("google", "u1", "wesley");
    expect(r).toMatchObject({ erro: expect.stringContaining("qual") });
    expect((r as { contas: string[] }).contas).toEqual(["wesley@gmail.com", "wesley@empresa.com"]);
  });

  it("pedido claro escolhe a conta certa", async () => {
    contas = [c("id-1", "wesley@gmail.com"), c("id-2", "wesley@empresa.com")];
    const r = await contaParaEscrever("google", "u1", "empresa");
    expect(r).toMatchObject({ token: "token-de-id-2", rotulo: "wesley@empresa.com" });
  });
});

describe("ler de todas as contas", () => {
  it("junta os itens marcando de qual conta cada um veio", async () => {
    tokens = [
      { conexao: c("a", "pessoal"), token: "t1" },
      { conexao: c("b", "trabalho"), token: "t2" },
    ];
    const r = await lerDeTodasAsContas("google", "u1", async (token) => [{ assunto: `de ${token}` }]);
    expect(r.contas).toBe(2);
    expect(r.itens).toEqual([
      { assunto: "de t1", conta: "pessoal" },
      { assunto: "de t2", conta: "trabalho" },
    ]);
    expect(r.falhas).toEqual([]);
  });

  it("uma conta com problema não esconde as outras", async () => {
    tokens = [
      { conexao: c("a", "pessoal"), token: "t1" },
      { conexao: c("b", "trabalho"), token: "quebrada" },
    ];
    const r = await lerDeTodasAsContas("google", "u1", async (token) => {
      if (token === "quebrada") throw new Error("401");
      return [{ assunto: "ok" }];
    });
    // a resposta consegue dizer "vi os seus e-mails, menos os do trabalho"
    expect(r.itens).toHaveLength(1);
    expect(r.falhas).toEqual(["trabalho"]);
  });

  it("sem conta conectada, devolve vazio sem erro", async () => {
    const r = await lerDeTodasAsContas("google", "u1", async () => [{ x: 1 }]);
    expect(r).toEqual({ itens: [], falhas: [], contas: 0 });
  });
});
