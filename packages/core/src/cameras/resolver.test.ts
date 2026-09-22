import { describe, it, expect } from "vitest";
import { cameraDoAparelho, ehAqui } from "./resolver";

/**
 * O caso que originou isto está medido em 22/09/2026: a câmera existia,
 * chamada "Câmera do notebook", o modelo pediu `local: "aqui"` — como a
 * própria tool instrui — e a busca por nome (`ILIKE %aqui%`) não achou nada.
 * A Órbita respondeu "nenhuma câmera foi encontrada" com uma câmera cadastrada
 * e um quadro recém-enviado.
 */
describe("o pedido é sobre onde a pessoa está?", () => {
  const sim = ["aqui", "meu notebook", "este aparelho", "minha câmera", "a webcam", "no celular", "", "agora"];
  for (const t of sim) it(`"${t}" é aqui`, () => expect(ehAqui(t)).toBe(true));

  const nao = ["garagem", "quarto da Madalena", "sala", "portão", "cozinha"];
  for (const t of nao) it(`"${t}" é um lugar, não aqui`, () => expect(ehAqui(t)).toBe(false));

  it("acento não muda a resposta", () => {
    expect(ehAqui("minha câmera")).toBe(true);
    expect(ehAqui("minha camera")).toBe(true);
  });
});

describe("qual delas é a do aparelho", () => {
  const c = (name: string) => ({ name });

  it("reconhece pelo nome que a criação automática usa", () => {
    expect(cameraDoAparelho([c("Cozinha"), c("Câmera do notebook")])?.name).toBe("Câmera do notebook");
    expect(cameraDoAparelho([c("Câmera do celular")])?.name).toBe("Câmera do celular");
    expect(cameraDoAparelho([c("Câmera do tablet")])?.name).toBe("Câmera do tablet");
  });

  it("sem nenhuma com cara de aparelho, não inventa", () => {
    // é o que impede "aqui" de virar a câmera da garagem numa casa com várias
    expect(cameraDoAparelho([c("Garagem"), c("Quintal")])).toBeNull();
  });

  it("lista vazia não quebra", () => {
    expect(cameraDoAparelho([])).toBeNull();
  });

  it("acento no nome não atrapalha", () => {
    expect(cameraDoAparelho([c("CÂMERA DO NOTEBOOK")])?.name).toBe("CÂMERA DO NOTEBOOK");
  });
});
