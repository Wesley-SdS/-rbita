import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pluggy pelo `.env` (pedido do dono, 12/10/2026): as credenciais do ambiente valem
 * SÓ para o dono da instância, a conexão salva pela tela vem antes, e os Item IDs
 * listados são lidos com folga (vírgula, espaço, quebra de linha).
 */

let contasSalvas: { accessTokenEnc: string }[] = [];
vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("../connectors/store", () => ({ listarContas: async () => contasSalvas, usersConnected: async () => [] }));
vi.mock("../owner", () => ({ getOwnerId: async () => "dono" }));
vi.mock("../crypto", () => ({ decryptSecret: (s: string) => s }));

const { credenciaisDoDono, donosComPluggy, itensDoAmbiente } = await import("./servico");

const ID = "0a1b2c3d-1111-2222-3333-444455556666";
const ambiente = { ...process.env };

beforeEach(() => {
  contasSalvas = [];
  process.env.PLUGGY_CLIENT_ID = "11111111-2222-4333-8444-555555555555";
  process.env.PLUGGY_CLIENT_SECRET = "segredo-de-teste";
});
afterEach(() => {
  process.env = { ...ambiente };
});

describe("credenciais da Pluggy pelo .env", () => {
  it("valem para o dono da instância, e só para ele", async () => {
    expect(await credenciaisDoDono("dono")).toEqual({ clientId: "11111111-2222-4333-8444-555555555555", clientSecret: "segredo-de-teste" });
    expect(await credenciaisDoDono("outra-pessoa-da-casa")).toBeNull();
    expect(await donosComPluggy()).toEqual(["dono"]);
  });

  it("a conexão salva pela tela vem antes do .env", async () => {
    contasSalvas = [{ accessTokenEnc: JSON.stringify({ clientId: "da-tela", clientSecret: "segredo-da-tela" }) }];
    expect(await credenciaisDoDono("dono")).toEqual({ clientId: "da-tela", clientSecret: "segredo-da-tela" });
  });

  it("sem as duas chaves, o .env não conta", async () => {
    delete process.env.PLUGGY_CLIENT_SECRET;
    expect(await credenciaisDoDono("dono")).toBeNull();
    expect(await donosComPluggy()).toEqual([]);
  });
});

describe("Item IDs do .env", () => {
  it("aceita vírgula, espaço e quebra de linha, ignora o que não é Item ID e não repete", () => {
    expect(itensDoAmbiente(` ${ID.toUpperCase()}, lixo ;\n${ID} 9f9f9f9f-0000-0000-0000-000000000001`)).toEqual([ID, "9f9f9f9f-0000-0000-0000-000000000001"]);
    expect(itensDoAmbiente("")).toEqual([]);
  });
});
