import { afterEach, describe, expect, it, vi } from "vitest";
import { centavosDoTexto, jurosDoTexto, textoDoCampo, textoDosJuros, tomDoSaldo, valorEmLista } from "./dinheiro";
import { excessoDoTeto, juntarOnde, largura, nDias, plural, semSufixoDeParcela, separarOnde, tomDaBarra } from "./apresentacao";
import { dimensoesReduzidas, escolherFotos, MAX_POR_SELECAO, TAMANHO_MAXIMO } from "./foto";
import { area, caminho, escalaDoRitmo, pontos } from "./grafico";
import { falhaDeVoz, juntarDitado } from "./voz";
import { gravarSessao, lerSessao } from "./sessao";
import { enviarComando, urlDaVista } from "./api";
import { lerCache, semear } from "@/lib/dados/cache";

describe("máscara de dinheiro (caixa registradora, §5.19)", () => {
  it("dígitos entram pela direita como centavos", () => {
    expect(centavosDoTexto("4")).toBe(4);
    expect(centavosDoTexto("45")).toBe(45);
    expect(centavosDoTexto("459")).toBe(459);
    expect(centavosDoTexto("4590")).toBe(4590);
    expect(textoDoCampo(4590)).toBe("45,90");
    expect(textoDoCampo(123456)).toBe("1.234,56");
  });

  it("ignora o que não é dígito, zeros à esquerda e o que passa de 11 dígitos", () => {
    expect(centavosDoTexto("R$ 1.234,56")).toBe(123456);
    expect(centavosDoTexto("000045")).toBe(45);
    expect(centavosDoTexto("123456789012345")).toBe(12345678901);
    expect(centavosDoTexto("")).toBe(0);
    expect(centavosDoTexto("abc")).toBe(0);
    expect(textoDoCampo(0)).toBe("");
  });
});

describe("valor em lista (§5.20)", () => {
  it("saída com menos, entrada com mais", () => {
    expect(valorEmLista(4590, "despesa")).toEqual({ texto: "− 45,90", tom: "saida" });
    expect(valorEmLista(120000, "receita")).toEqual({ texto: "+ 1.200,00", tom: "entrada" });
  });
  it("transferência não ganha sinal nem cor", () => {
    expect(valorEmLista(5000, "despesa", true)).toEqual({ texto: "50,00", tom: "neutro" });
    expect(tomDoSaldo(-1)).toBe("saida");
    expect(tomDoSaldo(0)).toBe("entrada");
  });
});

describe("juros da dívida (texto livre)", () => {
  it("aceita vírgula, ponto e vazio", () => {
    expect(jurosDoTexto("14,9")).toBe(14.9);
    expect(jurosDoTexto("2.5%")).toBe(2.5);
    expect(jurosDoTexto("")).toBe(0);
    expect(textoDosJuros(14.9)).toBe("14,9");
    expect(textoDosJuros(0)).toBe("");
  });
  it("recusa lixo e juros acima de 100%", () => {
    expect(jurosDoTexto("abc")).toBeNull();
    expect(jurosDoTexto("1,2,3")).toBeNull();
    expect(jurosDoTexto("150")).toBeNull();
  });
});

describe("apresentação", () => {
  it("plural e dias", () => {
    expect(plural(1, "conta vencida", "contas vencidas")).toBe("conta vencida");
    expect(plural(2, "conta vencida", "contas vencidas")).toBe("contas vencidas");
    expect(nDias(1)).toBe("1 dia");
    expect(nDias(4)).toBe("4 dias");
  });
  it("faixas da barra", () => {
    expect(tomDaBarra(10, 75, 100)).toBe("ok");
    expect(tomDaBarra(75, 75, 100)).toBe("alerta");
    expect(tomDaBarra(100, 75, 100)).toBe("perigo");
    expect(tomDaBarra(Number.NaN, 75, 100)).toBe("perigo");
    expect(largura(50, 200)).toBe(25);
    expect(largura(300, 200)).toBe(100);
    expect(largura(10, 0)).toBe(0);
  });
  it("onde: conta ou cartão", () => {
    expect(separarOnde("conta:a")).toEqual({ contaId: "a", cartaoId: null });
    expect(separarOnde("cartao:b")).toEqual({ contaId: null, cartaoId: "b" });
    expect(separarOnde("")).toEqual({ contaId: null, cartaoId: null });
    expect(juntarOnde("a", null)).toBe("conta:a");
    expect(juntarOnde("a", "b")).toBe("cartao:b");
    expect(juntarOnde(null, null)).toBe("");
  });
  it("descrição base de uma parcela", () => {
    expect(semSufixoDeParcela("Geladeira (2/10)")).toBe("Geladeira");
    expect(semSufixoDeParcela("Geladeira")).toBe("Geladeira");
  });
  it("excesso do teto da meta", () => {
    // teto 1.000, total 900 com o item antigo de 100; o item passa a 300
    expect(excessoDoTeto(100000, 90000, 10000, 30000)).toBe(10000);
    expect(excessoDoTeto(100000, 90000, 10000, 20000)).toBeNull();
    expect(excessoDoTeto(0, 90000, 0, 999999)).toBeNull();
  });
});

describe("redução de foto", () => {
  it("limita o lado maior mantendo a proporção", () => {
    expect(dimensoesReduzidas(4000, 3000)).toEqual({ largura: 900, altura: 675 });
    expect(dimensoesReduzidas(1080, 1920)).toEqual({ largura: 506, altura: 900 });
    expect(dimensoesReduzidas(640, 480)).toEqual({ largura: 640, altura: 480 });
  });
  it("recusa imagem sem dimensão", () => {
    expect(() => dimensoesReduzidas(0, 100)).toThrow();
  });
  it("seleção: só imagem, até 6, nada acima de 25 MB", () => {
    const img = (size: number) => ({ size, type: "image/jpeg" });
    const lote = [img(10), { size: 10, type: "application/pdf" }, img(TAMANHO_MAXIMO + 1), ...Array.from({ length: 8 }, () => img(5))];
    const escolhidas = escolherFotos(lote);
    expect(escolhidas).toHaveLength(MAX_POR_SELECAO);
    expect(escolhidas.every((a) => a.type.startsWith("image/") && a.size <= TAMANHO_MAXIMO)).toBe(true);
  });
});

describe("gráfico do ritmo", () => {
  it("o eixo x é o mês inteiro, mesmo com a série parando em hoje", () => {
    const ps = pontos([0, 50, 100], 5, 100, { largura: 400, altura: 100 });
    expect(ps).toEqual([[0, 100], [100, 50], [200, 0]]);
    expect(caminho(ps)).toBe("M0 100 L100 50 L200 0");
    expect(area(ps, { largura: 400, altura: 100 })).toBe("M0 100 L100 50 L200 0 L200 100 L0 100 Z");
  });
  it("sem escala não desenha", () => {
    expect(pontos([1, 2], 30, 0, { largura: 10, altura: 10 })).toEqual([]);
    expect(area([], { largura: 10, altura: 10 })).toBe("");
    expect(escalaDoRitmo([], [], null)).toBe(0);
    expect(escalaDoRitmo([0, 100], [0, 50], 200)).toBeCloseTo(220);
  });
});

describe("voz", () => {
  it("traduz os códigos do navegador", () => {
    expect(falhaDeVoz("not-allowed")).toEqual({ tipo: "bloqueado" });
    expect(falhaDeVoz("no-speech")).toEqual({ tipo: "recado", texto: "Não ouvi nada, toque e fale de novo" });
    expect(falhaDeVoz("aborted")).toEqual({ tipo: "nada" });
    expect(falhaDeVoz("network")).toEqual({ tipo: "recado", texto: "Não consegui ouvir, escreva abaixo" });
  });
  it("soma o ouvido ao que já estava escrito", () => {
    expect(juntarDitado("gastei 10", "no mercado")).toBe("gastei 10 no mercado");
    expect(juntarDitado("", " paguei 5 ")).toBe("paguei 5");
    expect(juntarDitado("nada", "")).toBe("nada");
  });
});

describe("estado por sessão", () => {
  const memoria = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("grava e lê de volta, completando com o padrão", () => {
    const s = memoria();
    gravarSessao("x", { aba: "extrato" }, s);
    expect(lerSessao("x", { aba: "painel", mes: null as string | null }, s)).toEqual({ aba: "extrato", mes: null });
  });
  it("armazenamento quebrado ou lixo vira o padrão", () => {
    const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("cheio"); } };
    expect(lerSessao("x", { aba: "painel" }, quebrado)).toEqual({ aba: "painel" });
    expect(() => gravarSessao("x", { a: 1 }, quebrado)).not.toThrow();
    const s = memoria();
    s.setItem("x", "[1,2]");
    expect(lerSessao("x", { aba: "painel" }, s)).toEqual({ aba: "painel" });
    s.setItem("x", "{nao é json");
    expect(lerSessao("x", { aba: "painel" }, s)).toEqual({ aba: "painel" });
    expect(lerSessao("x", { aba: "painel" }, null)).toEqual({ aba: "painel" });
  });
});

describe("comando", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sucesso devolve o resultado e vence as vistas das finanças", async () => {
    semear({ "/api/financas/painel?mes=2026-09": { ok: 1 }, "/api/financas/fotos?item=x": { fotos: [] } });
    expect(lerCache("/api/financas/painel?mes=2026-09").em).toBeGreaterThan(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ mensagem: "Saída de R$ 10,00 registrada.", desfazerId: "u" }), { status: 200 })));
    const r = await enviarComando({ tipo: "lancar", valor: 1000 });
    expect(r).toEqual({ ok: true, dado: { mensagem: "Saída de R$ 10,00 registrada.", desfazerId: "u" } });
    expect(lerCache("/api/financas/painel?mes=2026-09").em).toBe(0);
    // as fotos pesam e não mudam com um lançamento: continuam valendo
    expect(lerCache("/api/financas/fotos?item=x").em).toBeGreaterThan(0);
  });

  it("erro do backend vira a mensagem do PRD; sem rede, avisa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Informe um valor maior que zero." }), { status: 400 })));
    expect(await enviarComando({ tipo: "lancar", valor: 0 })).toEqual({ ok: false, erro: "Informe um valor maior que zero." });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await enviarComando({ tipo: "lancar", valor: 1 })).toEqual({ ok: false, erro: "Sem conexão com o servidor." });
  });

  it("url da vista sem parâmetro vazio", () => {
    expect(urlDaVista("painel", { mes: "2026-09" })).toBe("/api/financas/painel?mes=2026-09");
    expect(urlDaVista("extrato", { mes: "2026-09", q: "", natureza: null })).toBe("/api/financas/extrato?mes=2026-09");
    expect(urlDaVista("metas")).toBe("/api/financas/metas");
  });
});
