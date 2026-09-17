import { describe, it, expect } from "vitest";
import { extractJsonSubstring, stripJsonFences, tryParseJson } from "./structured";

describe("stripJsonFences", () => {
  it("remove cerca ```json ... ```", () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("remove cerca ``` ... ``` sem a palavra json", () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("sem cerca, devolve o texto (aparado)", () => {
    expect(stripJsonFences('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe("extractJsonSubstring", () => {
  it("corta prosa antes e depois do objeto", () => {
    expect(extractJsonSubstring('Aqui está: {"a":1} Espero que ajude!')).toBe('{"a":1}');
  });
  it("sem chaves, devolve o texto original", () => {
    expect(extractJsonSubstring("sem json nenhum aqui")).toBe("sem json nenhum aqui");
  });
});

describe("tryParseJson", () => {
  it("JSON puro", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("JSON dentro de cerca markdown", () => {
    expect(tryParseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("JSON com prosa ao redor", () => {
    expect(tryParseJson('Claro, aqui está:\n{"a":1}\nEspero ajudar!')).toEqual({ a: 1 });
  });
  it("JSON com prosa E cerca markdown juntos", () => {
    expect(tryParseJson('Segue:\n```json\n{"a":1}\n```\nAté mais!')).toEqual({ a: 1 });
  });
  it("texto não-JSON devolve null, não lança", () => {
    expect(tryParseJson("isso não é json de jeito nenhum")).toBeNull();
  });
  it("objeto aninhado sobrevive ao corte por chave externa", () => {
    expect(tryParseJson('texto {"a":{"b":2}} fim')).toEqual({ a: { b: 2 } });
  });
});
