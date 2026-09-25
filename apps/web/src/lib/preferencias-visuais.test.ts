import { describe, expect, it } from "vitest";
import { atributosDoHtml } from "./preferencias-visuais";

/**
 * O tema decidido no servidor.
 *
 * Isto era um `<script>` cru lendo `localStorage` antes do primeiro paint, que
 * o React 19 passou a acusar no console. A saída aparente (`next/script` com
 * `beforeInteractive`) foi MEDIDA: nesta versão do Next ela põe o script
 * depois do `<body>`, o que traria o flash de tema de volta. Por isso a
 * preferência virou cookie e o servidor manda o atributo pronto.
 */
describe("os atributos do <html>", () => {
  it("escuro vira data-theme", () => {
    expect(atributosDoHtml("escuro", undefined)).toEqual({ "data-theme": "dark" });
  });

  it("o PADRÃO não grava atributo nenhum", () => {
    // claro e barra aberta são o CSS base; escrever `data-theme="light"` criaria
    // um segundo jeito de dizer a mesma coisa
    expect(atributosDoHtml("claro", "aberta")).toEqual({});
    expect(atributosDoHtml(undefined, undefined)).toEqual({});
  });

  it("barra recolhida vira data-lateral", () => {
    expect(atributosDoHtml(undefined, "recolhida")).toEqual({ "data-lateral": "recolhida" });
  });

  it("os dois juntos", () => {
    expect(atributosDoHtml("escuro", "recolhida")).toEqual({ "data-theme": "dark", "data-lateral": "recolhida" });
  });

  it("aceita o valor antigo do localStorage", () => {
    // quem já usava a Órbita tem "dark" gravado; o cookie novo usa "escuro".
    // Aceitar os dois evita a pessoa perder o tema numa atualização.
    expect(atributosDoHtml("dark", undefined)).toEqual({ "data-theme": "dark" });
  });

  it("valor estranho não vira tema", () => {
    expect(atributosDoHtml("roxo", "flutuante")).toEqual({});
  });
});
