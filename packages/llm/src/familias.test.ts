import { describe, it, expect } from "vitest";
import { compararVersao, familiaDoModelo, filtrarModelos, ultimosDeCadaFamilia } from "./familias";

const m = (key: string, label = key) => ({ key, label });

describe("família e versão de um modelo", () => {
  it("separa o número da versão do nome", () => {
    expect(familiaDoModelo("google/gemini-3.8-flash")).toMatchObject({ chave: "google/gemini-flash", versao: [3, 8] });
    expect(familiaDoModelo("claude/claude-opus-5")).toMatchObject({ chave: "claude/claude-opus", versao: [5] });
  });

  it("id com caminho dentro do gateway mantém o caminho na família", () => {
    expect(familiaDoModelo("gateway/openai/gpt-5.1").chave).toBe("gateway/openai/gpt");
  });

  it("o que NÃO é versão continua distinguindo a família", () => {
    // codex é outro produto, não uma versão do gpt
    expect(familiaDoModelo("gateway/openai/gpt-5.1-codex").chave).not.toBe(familiaDoModelo("gateway/openai/gpt-5.1").chave);
  });

  it("reconhece rótulo de provisório", () => {
    expect(familiaDoModelo("google/gemini-3.1-flash-live-preview").provisorio).toBe(true);
    expect(familiaDoModelo("google/gemini-3.8-live").provisorio).toBe(false);
  });

  it("modelo sem versão nenhuma não quebra", () => {
    expect(familiaDoModelo("local/nomic-embed-text").versao).toEqual([]);
  });
});

describe("comparação de versão", () => {
  it("5.1 é mais novo que 5", () => {
    expect(compararVersao([5, 1], [5])).toBeGreaterThan(0);
  });
  it("3.8 é mais novo que 3.10 não: número, não texto", () => {
    expect(compararVersao([3, 10], [3, 8])).toBeGreaterThan(0);
  });
  it("iguais empatam", () => {
    expect(compararVersao([4, 0], [4])).toBe(0);
  });
});

describe("último de cada família", () => {
  it("de 5 e 5.1 da mesma família, fica só o 5.1", () => {
    const r = ultimosDeCadaFamilia([m("gateway/openai/gpt-5"), m("gateway/openai/gpt-5.1")]);
    expect(r.map((x) => x.key)).toEqual(["gateway/openai/gpt-5.1"]);
  });

  it("famílias diferentes sobrevivem lado a lado", () => {
    const r = ultimosDeCadaFamilia([m("gateway/openai/gpt-5.1"), m("gateway/openai/gpt-5.1-codex"), m("google/gemini-3.8-flash")]);
    expect(r).toHaveLength(3);
  });

  it("na mesma versão, o estável ganha do preview", () => {
    const r = ultimosDeCadaFamilia([m("google/gemini-3.1-flash-preview"), m("google/gemini-3.1-flash")]);
    expect(r.map((x) => x.key)).toEqual(["google/gemini-3.1-flash"]);
  });

  it("o mesmo modelo em provedores diferentes NÃO é a mesma família", () => {
    // o dono pode querer o Claude pela assinatura e o mesmo modelo pelo gateway
    const r = ultimosDeCadaFamilia([m("claude/claude-opus-5"), m("gateway/anthropic/claude-opus-5")]);
    expect(r).toHaveLength(2);
  });

  it("mantém a ordem de entrada entre famílias", () => {
    const r = ultimosDeCadaFamilia([m("b/modelo-1"), m("a/modelo-1"), m("b/modelo-2")]);
    expect(r.map((x) => x.key)).toEqual(["b/modelo-2", "a/modelo-1"]);
  });

  it("um catálogo grande encolhe de verdade", () => {
    const catalogo = [];
    for (const familia of ["gpt", "claude-opus", "claude-sonnet", "gemini-flash", "gemini-pro"]) {
      for (const v of [3, 4, 5]) catalogo.push(m(`gateway/x/${familia}-${v}`));
    }
    expect(catalogo).toHaveLength(15);
    expect(ultimosDeCadaFamilia(catalogo)).toHaveLength(5);
  });

  it("lista vazia não quebra", () => {
    expect(ultimosDeCadaFamilia([])).toEqual([]);
  });
});

describe("busca do seletor", () => {
  const lista = [m("google/gemini-3.8-flash", "Gemini 3.8 Flash"), m("claude/claude-opus-5", "Claude Opus 5"), m("local/qwen2.5:7b", "Qwen 2.5 7B")];

  it("acha pelo rótulo e pela chave", () => {
    expect(filtrarModelos(lista, "flash").map((x) => x.key)).toEqual(["google/gemini-3.8-flash"]);
    expect(filtrarModelos(lista, "qwen2.5").map((x) => x.key)).toEqual(["local/qwen2.5:7b"]);
  });

  it("ignora acento e caixa", () => {
    expect(filtrarModelos([m("x/y", "Opção Única")], "opcao").length).toBe(1);
  });

  it("vários termos são E, não OU", () => {
    expect(filtrarModelos(lista, "claude 5")).toHaveLength(1);
    expect(filtrarModelos(lista, "claude flash")).toHaveLength(0);
  });

  it("busca vazia devolve tudo", () => {
    expect(filtrarModelos(lista, "   ")).toHaveLength(3);
  });
});
