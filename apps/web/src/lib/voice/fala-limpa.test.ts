import { describe, expect, it } from "vitest";
import { paraFala } from "./fala-limpa";

/**
 * A Órbita falando "asterisco".
 *
 * Relatado pelo dono em 27/09/2026, num resumo de e-mails: a resposta vinha em
 * Markdown (`**GitHub (ontem…):**`, lista com traço, o e-mail como link) e a
 * voz lia os símbolos. O `speak` limpava; o `iniciarFluxo`, que é o caminho de
 * hoje porque fala enquanto o modelo escreve, mandava o Markdown cru ao
 * `/api/tts`.
 *
 * Estes testes são sobre o que se OUVE. Por isso checam a ausência dos
 * símbolos e a presença do conteúdo, nunca a formatação exata.
 */
describe("paraFala: o que o alto-falante recebe", () => {
  it("negrito perde os asteriscos e mantém a palavra", () => {
    expect(paraFala("**GitHub (ontem, por volta das 23h):** uma chave SSH foi adicionada.")).toBe(
      "GitHub (ontem, por volta das 23h): uma chave SSH foi adicionada.",
    );
  });

  it("itálico, negrito-itálico e riscado saem sem marca", () => {
    expect(paraFala("é *mesmo* urgente")).toBe("é mesmo urgente");
    expect(paraFala("é ***muito*** urgente")).toBe("é muito urgente");
    expect(paraFala("é _bem_ urgente")).toBe("é bem urgente");
    expect(paraFala("~~cancelado~~ confirmado")).toBe("cancelado confirmado");
  });

  it("LINK vira o texto dele, e o endereço NÃO é lido", () => {
    // o caso do print: tirar só os colchetes deixaria a URL para o TTS soletrar
    const r = paraFala("chegaram no Gmail [wesleysantos.0095@gmail.com](mailto:wesleysantos.0095@gmail.com).");
    expect(r).toBe("chegaram no Gmail wesleysantos.0095@gmail.com.");
    expect(r).not.toContain("mailto");
  });

  it("endereço solto no meio da frase some", () => {
    const r = paraFala("veja em https://github.com/settings/keys o quanto antes");
    expect(r).not.toContain("https");
    expect(r).toContain("veja em");
    expect(r).toContain("o quanto antes");
  });

  it("imagem some inteira, inclusive o texto alternativo", () => {
    expect(paraFala("olha ![gráfico de barras](/x.png) aqui")).toBe("olha aqui");
  });

  it("item de lista vira FRASE, para a voz respirar entre um e outro", () => {
    // sem o ponto, o TTS emenda os itens e a enumeração some na prosódia
    const r = paraFala("- C6 Bank: chegou a fatura\n- Catho: sugestão de vaga\n- SHEIN: propaganda");
    expect(r).toBe("C6 Bank: chegou a fatura.\nCatho: sugestão de vaga.\nSHEIN: propaganda.");
  });

  it("lista numerada mantém o número, que é informação", () => {
    expect(paraFala("1. Ligar a luz\n2. Trancar a porta")).toBe("1. Ligar a luz.\n2. Trancar a porta.");
  });

  it("item que já termina em pontuação não ganha outra", () => {
    expect(paraFala("- Pronto!")).toBe("Pronto!");
    expect(paraFala("- Só isso.")).toBe("Só isso.");
  });

  it("cabeçalho, citação e linha horizontal", () => {
    expect(paraFala("## Seus e-mails")).toBe("Seus e-mails");
    expect(paraFala("> ele disse que vem")).toBe("ele disse que vem");
    expect(paraFala("antes\n---\ndepois")).toBe("antes\n\ndepois");
  });

  it("código não é falado", () => {
    expect(paraFala("rode `npm test` agora")).toBe("rode npm test agora");
    expect(paraFala("assim:\n```js\nconst x = 1;\n```\npronto")).toBe("assim:\npronto");
  });

  it("tabela vira enumeração, sem os traços de separação", () => {
    const r = paraFala("| Banco | Valor |\n| --- | --- |\n| C6 | 320 |");
    expect(r).not.toContain("|");
    expect(r).toContain("C6, 320");
  });

  it("não inventa nem perde conteúdo num texto sem markdown", () => {
    const limpo = "Seus 5 e-mails mais recentes chegaram hoje. Dois são de segurança.";
    expect(paraFala(limpo)).toBe(limpo);
  });

  it("preço e versão sobrevivem: os pontos deles não são marcação", () => {
    expect(paraFala("a fatura é de R$ 1.500,30 no gpt-5.1")).toBe("a fatura é de R$ 1.500,30 no gpt-5.1");
  });

  it("multiplicação e sublinhado no meio de palavra não são ênfase", () => {
    // `2 * 3` e `nome_do_campo` não podem virar texto mutilado
    expect(paraFala("nome_do_campo continua inteiro")).toBe("nome_do_campo continua inteiro");
  });

  it("texto que é SÓ marcação vira vazio, e não um pedido de TTS", () => {
    expect(paraFala("---")).toBe("");
    expect(paraFala("```\ncode\n```")).toBe("");
    expect(paraFala("   ")).toBe("");
  });
});
