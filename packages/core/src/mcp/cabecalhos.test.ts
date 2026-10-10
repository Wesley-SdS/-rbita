import { beforeAll, describe, expect, it } from "vitest";
import { guardarCabecalhos, lerCabecalhos, nomesDosCabecalhos } from "./cabecalhos";

/**
 * Token de servidor MCP cifrado em repouso (§5.4). O formato antigo, em texto
 * puro, continua lido: servidor cadastrado antes não pode parar de conectar.
 */

beforeAll(() => {
  process.env.CONNECTORS_ENC_KEY ??= "chave-de-teste-com-tamanho-suficiente-123";
});

describe("cabeçalhos do MCP", () => {
  it("guardado não mostra o token, e volta igual na leitura", () => {
    const g = guardarCabecalhos({ Authorization: "Bearer mcp_segredo" });
    expect(JSON.stringify(g)).not.toContain("mcp_segredo");
    expect(lerCabecalhos(g)).toEqual({ Authorization: "Bearer mcp_segredo" });
    expect(nomesDosCabecalhos(g)).toEqual(["Authorization"]);
  });

  it("formato antigo, em texto puro, ainda conecta", () => {
    expect(lerCabecalhos({ "x-ada-token": "ada_x" })).toEqual({ "x-ada-token": "ada_x" });
  });

  it("vazio vira nulo, e valor adulterado não derruba ninguém", () => {
    expect(guardarCabecalhos({})).toBeNull();
    expect(guardarCabecalhos(undefined)).toBeNull();
    expect(lerCabecalhos(null)).toBeNull();
    expect(lerCabecalhos({ cifrado: "v1:lixo:lixo:lixo" })).toBeNull();
    expect(lerCabecalhos(["a"])).toBeNull();
  });
});
