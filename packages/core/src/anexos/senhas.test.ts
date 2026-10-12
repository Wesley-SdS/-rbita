import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Senhas de anexo por remetente (C5): o domínio certo, a senha cifrada em
 * repouso e nunca devolvida, e a senha de "nubank.com.br" sem valer para um
 * domínio de golpe que só COMEÇA igual.
 */

process.env.BETTER_AUTH_SECRET ??= "segredo-de-teste-com-mais-de-16";

const linhas = vi.hoisted(() => ({ salvas: [] as { id: string; dominio: string; senhaEnc: string; rotulo: string | null }[] }));
vi.mock("@orbita/db", () => {
  const select = () => ({ from: () => ({ where: () => Object.assign(Promise.resolve(linhas.salvas), { orderBy: async () => linhas.salvas }) }) });
  return {
    db: {
      select,
      insert: () => ({
        values: (v: { dominio: string; senhaEnc: string; rotulo: string | null }) => ({
          returning: async () => {
            const row = { id: `s${linhas.salvas.length + 1}`, ...v };
            linhas.salvas.push(row);
            return [{ id: row.id, dominio: v.dominio, rotulo: v.rotulo, criadaEm: new Date(), usadaEm: null }];
          },
        }),
      }),
    },
  };
});

import { assinadoPeloRemetente, cadastrarSenha, dominioCasa, dominioDoRemetente, normalizarDominio, senhasDoRemetente, SenhaDeAnexoInvalidaError } from "./senhas";

beforeEach(() => {
  linhas.salvas = [];
});

describe("de quem é o anexo", () => {
  it("o domínio sai do endereço do remetente", () => {
    expect(dominioDoRemetente("Nubank <todomundo@nubank.com.br>")).toBe("nubank.com.br");
    expect(dominioDoRemetente("faturas@Itau.com.br")).toBe("itau.com.br");
    expect(dominioDoRemetente("sem endereço")).toBeNull();
  });

  it("o que o dono digita vira domínio", () => {
    expect(normalizarDominio("@nubank.com.br")).toBe("nubank.com.br");
    expect(normalizarDominio("https://www.Nubank.com.br/fatura")).toBe("nubank.com.br");
    expect(normalizarDominio("todomundo@nubank.com.br")).toBe("nubank.com.br");
    expect(normalizarDominio("nubank")).toBeNull();
  });

  it("vale para o subdomínio, nunca para o domínio que só começa igual", () => {
    expect(dominioCasa("nubank.com.br", "fatura.nubank.com.br")).toBe(true);
    expect(dominioCasa("nubank.com.br", "nubank.com.br")).toBe(true);
    expect(dominioCasa("nubank.com.br", "nubank.com.br.golpe.io")).toBe(false);
    expect(dominioCasa("nubank.com.br", "falsonubank.com.br")).toBe(false);
  });
});

describe("guardar e tentar", () => {
  it("a senha é cifrada ao gravar, nunca volta na listagem, e é tentada só para o remetente certo", async () => {
    const r = await cadastrarSenha("u1", { dominio: "nubank.com.br", senha: "12345", rotulo: "fatura" });
    expect(r).not.toHaveProperty("senhaEnc");
    expect(JSON.stringify(r)).not.toContain("12345");
    expect(linhas.salvas[0]!.senhaEnc).toMatch(/^v1:/);
    expect(linhas.salvas[0]!.senhaEnc).not.toContain("12345");
    expect((await senhasDoRemetente("u1", "Nubank <x@fatura.nubank.com.br>")).senhas).toEqual(["12345"]);
    expect((await senhasDoRemetente("u1", "Golpe <x@nubank.com.br.golpe.io>")).senhas).toEqual([]);
  });

  it("remetente ou senha inválidos são recusados com mensagem para a tela", async () => {
    await expect(cadastrarSenha("u1", { dominio: "banco", senha: "1" })).rejects.toBeInstanceOf(SenhaDeAnexoInvalidaError);
    await expect(cadastrarSenha("u1", { dominio: "banco.com", senha: "" })).rejects.toThrow(/Digite a senha/);
  });
});

describe("o From só vale com a assinatura do domínio (M13)", () => {
  it("e-mail que diz ser do banco sem DKIM do banco: a senha nem é tentada", async () => {
    await cadastrarSenha("u1", { dominio: "nubank.com.br", senha: "12345" });
    // o golpista escreve o From do banco, mas quem assina é o domínio dele
    const forjado = await senhasDoRemetente("u1", "Nubank <x@nubank.com.br>", { autenticacao: "mx.google.com; dkim=pass header.d=golpe.io; spf=fail" });
    expect(forjado).toEqual({ ids: [], senhas: [], naoAutenticado: true });
    // dkim=fail do próprio domínio também não vale
    expect((await senhasDoRemetente("u1", "x@nubank.com.br", { autenticacao: "mx; dkim=fail header.d=nubank.com.br" })).naoAutenticado).toBe(true);
  });

  it("assinado pelo domínio (ou pelo de cima, como o banco assina a fatura de um subdomínio): tenta", async () => {
    await cadastrarSenha("u1", { dominio: "nubank.com.br", senha: "12345" });
    expect((await senhasDoRemetente("u1", "x@nubank.com.br", { autenticacao: "mx.google.com; dkim=pass header.d=nubank.com.br" })).senhas).toEqual(["12345"]);
    expect((await senhasDoRemetente("u1", "x@fatura.nubank.com.br", { autenticacao: "mx.google.com; dkim=pass header.d=nubank.com.br" })).senhas).toEqual(["12345"]);
    // controle: sem o cabeçalho (e-mail interno, provedor que não entrega), como antes
    expect((await senhasDoRemetente("u1", "x@nubank.com.br")).senhas).toEqual(["12345"]);
  });

  it("assinadoPeloRemetente (pura)", () => {
    expect(assinadoPeloRemetente("mx; dkim=pass header.d=nubank.com.br", "fatura.nubank.com.br")).toBe(true);
    expect(assinadoPeloRemetente("mx; dkim=pass header.d=golpe.io", "nubank.com.br")).toBe(false);
    expect(assinadoPeloRemetente("", "nubank.com.br")).toBe(false);
  });
});
