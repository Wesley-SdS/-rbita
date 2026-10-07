import { describe, expect, it } from "vitest";
import { fontesDoResultado, propostaDoResultado } from "./cartoes";

describe("cards de fonte da busca", () => {
  it("transforma resultados em cards com o site de cada notícia", () => {
    const f = fontesDoResultado({
      fonte: "brave",
      resultados: [
        { titulo: "Lula e Flávio vão ao segundo turno", url: "https://www.g1.globo.com/politica/x", trecho: "O primeiro turno..." },
        { titulo: " Apuração ", url: "https://noticias.uol.com.br/y", trecho: "" },
      ],
    });
    expect(f).toEqual([
      { titulo: "Lula e Flávio vão ao segundo turno", url: "https://www.g1.globo.com/politica/x", trecho: "O primeiro turno...", site: "g1.globo.com" },
      { titulo: "Apuração", url: "https://noticias.uol.com.br/y", trecho: "", site: "noticias.uol.com.br" },
    ]);
  });

  it("descarta link que não é http(s), sem título ou torto; resultado que não é busca não vira card", () => {
    const f = fontesDoResultado({
      resultados: [
        { titulo: "x", url: "javascript:alert(1)" },
        { titulo: "", url: "https://a.com" },
        { titulo: "y", url: "não é url" },
        "lixo",
      ],
    });
    expect(f).toEqual([]);
    expect(fontesDoResultado({ conteudo: "página" })).toEqual([]);
    expect(fontesDoResultado(null)).toEqual([]);
  });

  it("entende a busca nativa do Claude (lista de url e title) e não repete link", () => {
    const f = fontesDoResultado([
      { type: "web_search_result", url: "https://www.cnnbrasil.com.br/a", title: "Segundo turno", pageAge: "1 dia", encryptedContent: "x" },
      { type: "web_search_result", url: "https://www.cnnbrasil.com.br/a", title: "Repetido" },
    ]);
    expect(f).toEqual([{ titulo: "Segundo turno", url: "https://www.cnnbrasil.com.br/a", trecho: "", site: "cnnbrasil.com.br" }]);
  });

  it("no máximo seis cards", () => {
    const resultados = Array.from({ length: 10 }, (_, i) => ({ titulo: `t${i}`, url: `https://s${i}.com` }));
    expect(fontesDoResultado({ resultados })).toHaveLength(6);
  });
});

describe("proposta para aprovar", () => {
  it("resultado enfileirado vira cartão com os argumentos da tool", () => {
    const p = propostaDoResultado(
      "enviar_whatsapp",
      { proposta_enfileirada: true, aguardando_aprovacao: true, id: "a1", resumo: "Mandar para o Amor: chego às 19h" },
      { para: "Amor", texto: "chego às 19h" },
    );
    expect(p).toEqual({ id: "a1", kind: "enviar_whatsapp", resumo: "Mandar para o Amor: chego às 19h", payload: { para: "Amor", texto: "chego às 19h" } });
  });

  it("resultado comum, sem id ou com argumentos que não são objeto", () => {
    expect(propostaDoResultado("x", { ok: true }, {})).toBeNull();
    expect(propostaDoResultado("x", { proposta_enfileirada: true }, {})).toBeNull();
    expect(propostaDoResultado("x", { aguardando_aprovacao: true, id: "b" }, [1, 2])?.payload).toEqual({});
  });
});
