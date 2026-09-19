import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));

import { confiancaDaPagina } from "./tesseract";
import { temCamadaDeTexto } from "./pdf";
import { precisaDeVisao } from "./index";
import { ondeLer } from "./visao";
import { agruparEmLinhas, detectarTabelas, paraMarkdown, textoComTabelas } from "./tabela";

describe("confiança da página", () => {
  it("pondera pelo tamanho da palavra: uma letra solta não afunda a página", () => {
    const palavras = [
      { texto: "CNPJ", confianca: 95 },
      { texto: "62.225.325/0001-20", confianca: 93 },
      { texto: "|", confianca: 10 },
    ];
    const { confianca } = confiancaDaPagina(palavras, 66);
    // a media simples do Tesseract daria 0,66; ponderada pelo tamanho fica ~0,90
    expect(confianca).toBeGreaterThan(0.88);
    expect(confianca).toBeGreaterThan(0.66);
  });

  it("marca a fração de palavras ruins mesmo com média boa", () => {
    const palavras = [
      { texto: "documento", confianca: 96 },
      { texto: "a", confianca: 12 },
      { texto: "b", confianca: 20 },
    ];
    const r = confiancaDaPagina(palavras, 90);
    expect(r.fracaoRuim).toBeCloseTo(2 / 3, 2);
  });

  it("sem palavras, cai para a média do próprio Tesseract", () => {
    expect(confiancaDaPagina([], 80).confianca).toBeCloseTo(0.8, 2);
    expect(confiancaDaPagina([], 30).fracaoRuim).toBe(1);
  });
});

describe("página tem camada de texto?", () => {
  it("página escaneada (sem texto) não tem", () => {
    expect(temCamadaDeTexto("", 80)).toBe(false);
    expect(temCamadaDeTexto("   \n ", 80)).toBe(false);
  });

  it("carimbo curto não conta como camada de texto", () => {
    expect(temCamadaDeTexto("Página 3", 80)).toBe(false);
  });

  it("texto de verdade conta", () => {
    expect(temCamadaDeTexto("Contrato de locação de veículos entre a locadora e o cliente, com as cláusulas gerais a seguir.", 80)).toBe(true);
  });

  it("fonte sem mapa de caracteres (lixo) não conta", () => {
    const lixo = "(cid:12)(cid:45)".repeat(30);
    expect(temCamadaDeTexto(lixo, 80)).toBe(false);
    expect(temCamadaDeTexto("�".repeat(200), 80)).toBe(false);
  });
});

describe("quando a página precisa do modelo de visão", () => {
  const limites = { minConfianca: 0.6, minChars: 80, maxFracaoRuim: 0.25 };

  it("texto curto demais vai para a visão", () => {
    expect(precisaDeVisao({ texto: "R$ 12,00", confianca: 0.95, fracaoRuim: 0 }, limites)).toEqual({ precisa: true, motivo: "texto_curto" });
  });

  it("confiança baixa vai para a visão", () => {
    expect(precisaDeVisao({ texto: "x".repeat(200), confianca: 0.4, fracaoRuim: 0 }, limites).motivo).toBe("confianca_baixa");
  });

  it("média boa com muitas palavras ruins também vai (o caso da tabela)", () => {
    expect(precisaDeVisao({ texto: "x".repeat(200), confianca: 0.8, fracaoRuim: 0.5 }, limites).motivo).toBe("muitas_palavras_ruins");
  });

  it("página bem lida não paga o custo da visão", () => {
    expect(precisaDeVisao({ texto: "x".repeat(200), confianca: 0.85, fracaoRuim: 0.05 }, limites)).toEqual({ precisa: false, motivo: null });
  });
});

describe("onde a página é lida (privacidade)", () => {
  it("'nunca' não manda para lugar nenhum", () => {
    expect(ondeLer("nunca", true)).toBeNull();
  });

  it("'local' fica em casa mesmo havendo chave de nuvem", () => {
    expect(ondeLer("local", true)).toBe("local");
  });

  it("'nuvem' sem chave nenhuma cai para o local, não falha calado", () => {
    expect(ondeLer("nuvem", false)).toBe("local");
  });

  it("'auto' usa a nuvem quando existe chave", () => {
    expect(ondeLer("auto", true)).toBe("nuvem");
    expect(ondeLer("auto", false)).toBe("local");
  });
});

describe("tabela em PDF nativo", () => {
  // três linhas de um extrato, com as colunas alinhadas nas mesmas posições x
  const item = (texto: string, x: number, y: number) => ({ texto, x, y, largura: texto.length * 5, altura: 10 });
  const itens = [
    item("Data", 50, 300), item("Descrição", 150, 300), item("Valor", 400, 300),
    item("09/03/2026", 50, 280), item("PIX SHPP BRASIL", 150, 280), item("-162,64", 400, 280),
    item("17/03/2026", 50, 260), item("PIX ESTAPAR", 150, 260), item("-63,00", 400, 260),
    item("27/03/2026", 50, 240), item("PIX MODA MUNDIAL", 150, 240), item("-89,97", 400, 240),
  ];

  it("agrupa itens da mesma altura numa linha só, da esquerda para a direita", () => {
    const linhas = agruparEmLinhas(itens);
    expect(linhas).toHaveLength(4);
    expect(linhas[0]!.celulas.map((c) => c.texto)).toEqual(["Data", "Descrição", "Valor"]);
  });

  it("reconhece a tabela e devolve Markdown com cabeçalho", () => {
    const linhas = agruparEmLinhas(itens);
    const tabelas = detectarTabelas(linhas, 3, 3);
    expect(tabelas).toHaveLength(1);
    const md = paraMarkdown(tabelas[0]!);
    expect(md.split("\n")[0]).toBe("| Data | Descrição | Valor |");
    expect(md).toContain("| --- | --- | --- |");
    expect(md).toContain("| 17/03/2026 | PIX ESTAPAR | -63,00 |");
  });

  it("texto corrido não vira tabela", () => {
    const prosa = [item("Prezado cliente, seja bem-vindo", 50, 300), item("ao financiamento habitacional.", 50, 280)];
    expect(detectarTabelas(agruparEmLinhas(prosa), 3, 3)).toHaveLength(0);
    expect(textoComTabelas(prosa, "Prezado cliente…", { minLinhas: 3, minColunas: 3 }).tabelas).toBe(0);
  });

  it("sem posições, devolve o texto original sem inventar tabela", () => {
    expect(textoComTabelas([], "texto qualquer", { minLinhas: 3, minColunas: 3 })).toEqual({ texto: "texto qualquer", tabelas: 0 });
  });
});
