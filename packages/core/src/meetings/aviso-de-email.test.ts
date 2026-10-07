import { describe, expect, it, vi } from "vitest";

const gerado: { texto?: string; falha?: boolean } = {};
vi.mock("../llm/gerar", () => ({
  gerarTexto: async () => {
    if (gerado.falha) throw new Error("sem modelo");
    return { texto: gerado.texto ?? "", modelKey: "x" };
  },
}));

const { remetenteLegivel, resumoDeReserva, limparTextoDoModelo, resumirEmail } = await import("./aviso-de-email");

// os e-mails reais que chegaram feios no WhatsApp em 05/10/2026
const C6 = {
  de: '"C6 Empresas: Pix enviado" <no-reply@c6bank.com.br>',
  assunto: "Confira os detalhes da transação.",
  trecho: "C6 Bank Olá, Pix enviado no valor de R$ 25.916,00, para WESLEY SOUZA DOS SANTOS, em 05/10/2026. Até mais, Time C6 Empresas Logo C6 Bank Quer tirar suas dúvidas sobre nossos produtos",
};

describe("aviso de e-mail", () => {
  it("o remetente vira a marca, sem endereço nem assunto colado", () => {
    expect(remetenteLegivel(C6.de)).toBe("C6 Empresas");
    expect(remetenteLegivel("Shopee <info@mail.shopee.com.br>")).toBe("Shopee");
    expect(remetenteLegivel("no-reply@itau.com.br")).toBe("Itau");
    expect(remetenteLegivel("")).toBe("alguém");
  });

  it("a reserva corta o rodapé e a saudação", () => {
    const r = resumoDeReserva(C6.assunto, C6.trecho);
    expect(r).toContain("R$ 25.916,00");
    expect(r).not.toMatch(/Até mais|Logo C6|Quer tirar/);
    expect(r).not.toMatch(/: C6 Bank Olá/);
  });

  it("texto longo é cortado no fim de uma frase", () => {
    const r = resumoDeReserva("Assunto", "Primeira frase longa sobre o pedido. ".repeat(12), 120);
    expect(r.length).toBeLessThanOrEqual(121);
    expect(r.endsWith(".") || r.endsWith("…")).toBe(true);
  });

  it("markdown do modelo não chega cru ao WhatsApp", () => {
    expect(limparTextoDoModelo("## Pix\n- Saiu um **Pix** de R$ 10")).toBe("Pix Saiu um Pix de R$ 10");
    // o caso real de 06/10: o modelo pôs travessão mesmo pedindo frase simples
    expect(limparTextoDoModelo("Caiu um Pix de R$ 14.435,98 — não precisa fazer nada.")).toBe("Caiu um Pix de R$ 14.435,98, não precisa fazer nada.");
  });

  it("usa o texto do modelo; se ele falhar ou vier vazio, cai na reserva", async () => {
    gerado.texto = "Saiu um Pix de R$ 25.916,00 da conta do C6 para você hoje.";
    expect(await resumirEmail("u1", C6)).toBe("Saiu um Pix de R$ 25.916,00 da conta do C6 para você hoje.");
    gerado.texto = "";
    expect(await resumirEmail("u1", C6)).toBe(resumoDeReserva(C6.assunto, C6.trecho));
    gerado.falha = true;
    expect(await resumirEmail("u1", C6)).toContain("R$ 25.916,00");
  });
});
