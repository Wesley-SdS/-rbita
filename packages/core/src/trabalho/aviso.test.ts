import { describe, expect, it } from "vitest";
import { textoDoAvisoDeTrabalho, type NovidadeParaAviso } from "./aviso";

const n = (p: Partial<NovidadeParaAviso>): NovidadeParaAviso => ({ provedor: "github", tipo: "comentario", contexto: "org/app#42: Corrige o login", autor: "caio", estado: null, trecho: "Pode trocar o nome da variável?", conta: "wesley", ...p });

describe("aviso do trabalho", () => {
  it("vários comentários na mesma PR viram uma linha só", () => {
    const { titulo, corpo } = textoDoAvisoDeTrabalho([n({}), n({ trecho: "outro" }), n({ autor: "ana" })]);
    expect(titulo).toBe("Chegou algo para você no trabalho");
    expect(corpo).toBe("*No GitHub*\ncaio e ana comentaram 3 vezes em a PR #42 (Corrige o login).");
  });

  it("pedido de mudança manda no título e na frase", () => {
    const { titulo, corpo } = textoDoAvisoDeTrabalho([n({ tipo: "review", estado: "CHANGES_REQUESTED", autor: "ana" }), n({})]);
    expect(titulo).toBe("Pediram mudanças numa PR sua");
    expect(corpo).toContain("ana pediu mudanças em a PR #42");
  });

  it("aprovação, pedido de review e Slack, separados por serviço e sem travessão", () => {
    const { titulo, corpo } = textoDoAvisoDeTrabalho([
      n({ tipo: "review", estado: "APPROVED", autor: "ana" }),
      n({ tipo: "pedido_review", contexto: "org/api#7: Novo endpoint — v2", autor: "bia" }),
      n({ provedor: "slack", tipo: "mencao", contexto: "#time-dev", autor: "Rafa", trecho: "@você consegue olhar o deploy?" }),
      n({ provedor: "slack", tipo: "mensagem_direta", contexto: "mensagem direta", autor: "Lu", trecho: "oi" }),
    ]);
    expect(titulo).toBe("4 novidades no seu trabalho");
    expect(corpo).toContain("ana aprovou a PR #42 (Corrige o login).");
    expect(corpo).toContain("bia pediu o seu review em a PR #7 (Novo endpoint, v2).");
    expect(corpo).not.toMatch(/[—–]/);
    expect(corpo).toContain('*No Slack*\nRafa te mencionou em #time-dev: "@você consegue olhar o deploy?"');
    expect(corpo).toContain('Lu te mandou mensagem: "oi"');
    expect(corpo.indexOf("*No GitHub*")).toBeLessThan(corpo.indexOf("*No Slack*"));
  });

  it("muitas novidades cortam com um resto contado", () => {
    const muitas = Array.from({ length: 11 }, (_, i) => n({ contexto: `org/app#${i}: PR ${i}` }));
    expect(textoDoAvisoDeTrabalho(muitas).corpo).toContain("E mais 3 na tela inicial.");
  });
});
