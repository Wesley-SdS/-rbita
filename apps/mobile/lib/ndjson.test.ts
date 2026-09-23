import { describe, expect, it } from "vitest";
import { LeitorNdjson, textoDoEvento } from "./ndjson";

/**
 * O app estava QUEBRADO contra o servidor e ninguém tinha percebido.
 *
 * O `/api/chat` passou a mandar NDJSON (uma linha JSON por evento) e o app
 * continuou acumulando os bytes crus: a resposta aparecia na tela como
 * `{"t":"text","v":"Olá"}` literal.
 *
 * O que este arquivo trava é o caso que o streaming garante: a leitura de rede
 * corta no meio de uma linha o tempo todo, e o pedaço incompleto tem de
 * esperar o resto em vez de virar lixo na tela.
 */
describe("o leitor de NDJSON", () => {
  it("junta o texto de vários eventos", () => {
    const l = new LeitorNdjson();
    const evs = l.alimentar('{"t":"text","v":"Olá"}\n{"t":"text","v":", tudo bem?"}\n');
    expect(evs.map(textoDoEvento).join("")).toBe("Olá, tudo bem?");
  });

  it("LINHA PARTIDA no meio espera o resto", () => {
    // é o caso que sempre acontece: `{"t":"te` numa leitura, o resto na outra
    const l = new LeitorNdjson();
    expect(l.alimentar('{"t":"te')).toEqual([]);
    expect(l.alimentar('xt","v":"oi"}\n').map(textoDoEvento)).toEqual(["oi"]);
  });

  it("um evento partido em três pedaços ainda chega inteiro", () => {
    const l = new LeitorNdjson();
    l.alimentar('{"t":"text"');
    l.alimentar(',"v":"pedaço');
    expect(l.alimentar(' final"}\n').map(textoDoEvento)).toEqual(["pedaço final"]);
  });

  it("evento que não é texto não vira texto", () => {
    const l = new LeitorNdjson();
    const evs = l.alimentar('{"t":"tool","name":"ler_emails"}\n{"t":"text","v":"achei"}\n');
    expect(evs.map(textoDoEvento).join("")).toBe("achei");
    expect(evs[0]!.t).toBe("tool");
  });

  it("linha inválida não derruba o resto da resposta", () => {
    const l = new LeitorNdjson();
    const evs = l.alimentar('isto nao e json\n{"t":"text","v":"mas isto e"}\n');
    expect(evs.map(textoDoEvento).join("")).toBe("mas isto e");
  });

  it("o último evento sem quebra de linha não se perde", () => {
    // o servidor pode fechar o stream sem o \n final
    const l = new LeitorNdjson();
    expect(l.alimentar('{"t":"text","v":"fim"}')).toEqual([]);
    expect(l.fim().map(textoDoEvento)).toEqual(["fim"]);
  });

  it("fim() sem sobra não inventa evento", () => {
    const l = new LeitorNdjson();
    l.alimentar('{"t":"text","v":"a"}\n');
    expect(l.fim()).toEqual([]);
  });

  it("linha em branco é ignorada", () => {
    const l = new LeitorNdjson();
    expect(l.alimentar('\n\n{"t":"text","v":"x"}\n\n').map(textoDoEvento)).toEqual(["x"]);
  });
});
