import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A trilha (PRD F3): o que se grava da entrada (só o alvo, curto, nunca o texto
 * a digitar), o resumo do resultado (sem a imagem) e o `comTrilha` para quem
 * age fora do registro: grava ANTES, atualiza depois, relança o erro.
 */

const inseridos: Record<string, unknown>[] = [];
const atualizados: Record<string, unknown>[] = [];
vi.mock("@orbita/db", () => ({
  db: {
    insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: async () => (inseridos.push(v), [{ id: `p${inseridos.length}` }]) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void atualizados.push(v) }) }),
  },
}));

const { alvoDaEntrada, acaoDaEntrada, comTrilha, miniaturaDaSaida, resumoDoResultado } = await import("./trilha");
const { comImagem } = await import("./imagem");

beforeEach(() => {
  inseridos.length = 0;
  atualizados.length = 0;
});

describe("o que entra na trilha", () => {
  it("só os campos que dizem ONDE; o texto a digitar e o conteúdo entram como tamanho", () => {
    const a = alvoDaEntrada({ acao: "digitar", alvo: { rotulo: "Senha", papel: "edit", texto: "segredo" }, app: "Chrome", texto: "minha senha 123", conteudo: "x".repeat(10), pagina: "<html>…" });
    expect(a).toEqual({ alvo: { rotulo: "Senha", papel: "edit" }, app: "Chrome", texto_caracteres: 15, conteudo_caracteres: 10 });
    expect(JSON.stringify(a)).not.toContain("minha senha");
    expect(alvoDaEntrada({ comando: "a".repeat(500) }).comando).toHaveLength(201);
    expect(acaoDaEntrada({ acao: "clicar" })).toBe("clicar");
    expect(acaoDaEntrada("x")).toBeNull();
  });

  it("resumo do resultado sem a imagem, curto, pela frase quando há", () => {
    const comFoto = comImagem({ mensagem: "vi a janela" }, { base64: "QUJD".repeat(1000), mediaType: "image/png", alternativa: { tipo: "arvore", texto: "[1]" } });
    expect(resumoDoResultado(comFoto)).toBe("vi a janela");
    expect(resumoDoResultado({ dados: "y".repeat(1000) })).toHaveLength(300);
    expect(resumoDoResultado("texto")).toBe("texto");
  });

  it("miniatura só com a chave ligada e só imagem embutida", () => {
    const s = comImagem({}, { base64: "x", mediaType: "image/png", alternativa: { tipo: "narracao", texto: "" }, miniatura: "data:image/png;base64,AA==" });
    expect(miniaturaDaSaida(s, false)).toBeNull();
    expect(miniaturaDaSaida(s, true)).toBe("data:image/png;base64,AA==");
    expect(miniaturaDaSaida(comImagem({}, { base64: "x", mediaType: "image/png", alternativa: { tipo: "narracao", texto: "" }, miniatura: "https://x/y.png" }), true)).toBeNull();
  });
});

describe("comTrilha (quem age fora do registro)", () => {
  it("grava ANTES de executar e marca executado depois", async () => {
    let gravadoAntes = false;
    const r = await comTrilha({ userId: "u1", tool: "computador_agir", risco: "escrita", entrada: { acao: "clicar", app: "Code" }, sessaoId: "s1" }, async () => {
      gravadoAntes = inseridos.length === 1;
      return { mensagem: "ok" };
    });
    expect(r).toEqual({ mensagem: "ok" });
    expect(gravadoAntes).toBe(true);
    expect(inseridos[0]).toMatchObject({ decisao: "executando", tool: "computador_agir", acao: "clicar", sessaoId: "s1", alvo: { app: "Code" } });
    expect(atualizados[0]).toMatchObject({ decisao: "executado", resultado: "ok" });
  });

  it("falha vira 'falhou' com o motivo, e o erro continua subindo", async () => {
    await expect(comTrilha({ userId: "u1", tool: "terminal_x", risco: "leitura" }, async () => Promise.reject(new Error("a tela mudou")))).rejects.toThrow("a tela mudou");
    expect(atualizados[0]).toMatchObject({ decisao: "falhou", resultado: "a tela mudou" });
  });
});

describe("segredo não vai para a trilha (O5 da revisão)", () => {
  it("comando e url gravados com o segredo mascarado; o resto continua legível", () => {
    const a = alvoDaEntrada({
      comando: 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123" https://api.x.com && git clone https://wesley:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y',
      url: "https://app.exemplo.com/callback?code=4/0AbCdEf123456&state=ok&access_token=eyJabc.def#id_token=xyz123&aba=2",
    });
    const tudo = JSON.stringify(a);
    for (const s of ["sk-ant-api03-abcdefghij", "ghp_abcdefghij", "4/0AbCdEf123456", "eyJabc.def", "xyz123"]) expect(tudo).not.toContain(s);
    // o nome e o caminho continuam legíveis (depois de um token, a máscara de chave=valor engole o resto: melhor sobrar do que faltar)
    expect(String(a.url).startsWith("https://app.exemplo.com/callback?code=[segredo]&state=ok&access_token=[segredo]")).toBe(true);
    expect(String(a.comando)).toContain("https://wesley:[segredo]@github.com/x/y");
    // controle: o que não é segredo chega como era
    expect(alvoDaEntrada({ comando: "git status", url: "https://jira.com/browse/TECH-1?filtro=meus" })).toEqual({ comando: "git status", url: "https://jira.com/browse/TECH-1?filtro=meus" });
  });

  it("o valor de um segredo do ambiente some da trilha, inclusive no resultado", async () => {
    const { mascararNaTrilha } = await import("./segredos");
    expect(mascararNaTrilha("echo abcd1234efgh5678 > x", ["abcd1234efgh5678"])).toBe("echo [segredo] > x");
    process.env.ORBITA_TESTE_TOKEN = "valor-secreto-123456";
    try {
      expect(resumoDoResultado({ erro: "falhou: TOKEN=valor-secreto-123456 recusado" })).not.toContain("valor-secreto-123456");
      expect(alvoDaEntrada({ comando: "echo valor-secreto-123456" }).comando).toBe("echo [segredo]");
    } finally {
      delete process.env.ORBITA_TESTE_TOKEN;
    }
  });

  it("erro e motivo gravados direto (recusa da guarda, exceção no comTrilha) também saem mascarados (I11)", async () => {
    const { registrarPasso, atualizarPasso } = await import("./trilha");
    const vazado = "falhou: git push https://wesley:ghp_SenhaQueNaoPodeFicar123@github.com/x/y.git?access_token=abc123segredo";
    await registrarPasso({ userId: "u1", tool: "terminal_executar", risco: "leitura", decisao: "recusado", resultado: vazado });
    await atualizarPasso("p1", { decisao: "falhou", resultado: vazado });
    await expect(comTrilha({ userId: "u1", tool: "computador_agir", risco: "escrita" }, async () => Promise.reject(new Error(vazado)))).rejects.toThrow();
    const gravados = [inseridos[0]!.resultado, atualizados[0]!.resultado, atualizados.at(-1)!.resultado].map(String);
    for (const g of gravados) {
      expect(g).not.toContain("ghp_SenhaQueNaoPodeFicar123");
      expect(g).not.toContain("abc123segredo");
      // controle: o resto da frase continua legível
      expect(g).toContain("falhou: git push https://wesley:[segredo]@github.com/x/y.git");
    }
    expect(gravados.every((g) => g.length <= 300)).toBe(true);
  });
});

describe("o resumo do resultado corta antes de mascarar (G2 da auditoria)", () => {
  it("a saída patológica de 400 mil caracteres vira resumo na hora, e o segredo no começo continua mascarado", () => {
    const saida = { codigo: 0, saida: `TOKEN=valor-secreto-123456 ${"a.".repeat(200_000)}` };
    const inicio = Date.now();
    const r = resumoDoResultado(saida);
    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(r.length).toBeLessThanOrEqual(300);
    expect(r).not.toContain("valor-secreto-123456");
    expect(r).toContain("[segredo]");
  });
});
