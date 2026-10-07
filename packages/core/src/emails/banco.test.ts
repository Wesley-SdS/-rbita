import { describe, expect, it } from "vitest";
import { autenticadoPor, bancoConfiavel, cartaoDaFatura, contaDoBanco, contaQueEstePagamentoQuita, descricaoDaMovimentacao, enderecoDe, lerCobranca, lerMovimentacao, valorEmCentavos, vencimentoDoTexto } from "./banco";

describe("de quem é o e-mail", () => {
  it("endereço sem o nome, e só se for endereço", () => {
    expect(enderecoDe("Nubank <TodoMundo@nubank.com.br>")).toBe("todomundo@nubank.com.br");
    expect(enderecoDe("alertas@itau.com.br")).toBe("alertas@itau.com.br");
    expect(enderecoDe("Fulano")).toBe("");
  });

  it("banco confiável aceita subdomínio, mas não domínio parecido", () => {
    expect(bancoConfiavel("a@comunicacao.itau.com.br", ["itau.com.br"])).toBe("itau.com.br");
    expect(bancoConfiavel("a@nubank.com.br", ["@nubank.com.br"])).toBe("@nubank.com.br");
    // o golpe clássico: o nome do banco DENTRO de outro domínio
    expect(bancoConfiavel("a@nubank.com.br.golpe.com", ["nubank.com.br"])).toBeNull();
    expect(bancoConfiavel("a@falsonubank.com.br", ["nubank.com.br"])).toBeNull();
  });
});

describe("assinatura do domínio (DKIM)", () => {
  const gmail = "mx.google.com; dkim=pass header.i=@nubank.com.br header.s=s1 header.b=abc; spf=pass smtp.mailfrom=nubank.com.br; dmarc=pass header.from=nubank.com.br";
  it("pass do próprio domínio vale", () => {
    expect(autenticadoPor(gmail, "nubank.com.br")).toBe(true);
    expect(autenticadoPor("x; dkim=pass header.d=mail.itau.com.br", "itau.com.br")).toBe(true);
  });
  it("pass de OUTRO domínio, fail ou cabeçalho ausente não valem", () => {
    expect(autenticadoPor("mx; dkim=pass header.d=golpe.com", "nubank.com.br")).toBe(false);
    expect(autenticadoPor("mx; dkim=fail header.d=nubank.com.br", "nubank.com.br")).toBe(false);
    expect(autenticadoPor("", "nubank.com.br")).toBe(false);
  });
});

describe("a movimentação do e-mail", () => {
  it("Pix recebido, com quem mandou", () => {
    const m = lerMovimentacao("Você recebeu um Pix", "Você recebeu um Pix de R$ 1.250,00 de Maria Souza no dia 06/10.");
    expect(m).toEqual({ natureza: "receita", valor: 125000, contraparte: "Maria Souza" });
    expect(descricaoDaMovimentacao(m!)).toBe("Recebido de Maria Souza");
  });

  it("compra e pagamento viram despesa", () => {
    expect(lerMovimentacao("Compra aprovada", "Compra aprovada no crédito de R$ 89,90 em Padaria Central.")).toMatchObject({ natureza: "despesa", valor: 8990, contraparte: "Padaria Central" });
    expect(lerMovimentacao("Pagamento realizado", "O pagamento de R$ 391,90 foi realizado.")).toMatchObject({ natureza: "despesa", valor: 39190 });
  });

  it("o que ainda vai acontecer, ou é ambíguo, não é lido", () => {
    expect(lerMovimentacao("Sua fatura vence amanhã", "Pagamento realizado até R$ 391,90")).toBeNull();
    expect(lerMovimentacao("Pix", "Você recebeu um Pix e fez um pagamento realizado de R$ 10,00")).toBeNull();
    expect(lerMovimentacao("Novidades", "Conheça o novo cartão")).toBeNull();
    expect(lerMovimentacao("Você recebeu um Pix", "Abra o app para ver")).toBeNull();
  });

  it("valor em reais com milhar e centavos", () => {
    expect(valorEmCentavos("R$ 39.000,00")).toBe(3900000);
    expect(valorEmCentavos("R$0,50")).toBe(50);
    expect(valorEmCentavos("R$ 10")).toBeNull();
  });
});

describe("em qual conta lançar", () => {
  const contas = [{ id: "1", nome: "Nubank" }, { id: "2", nome: "Itaú Personnalité" }, { id: "3", nome: "Carteira" }];
  it("a conta com o nome do banco", () => {
    expect(contaDoBanco(contas, "comunicacao.itau.com.br")?.id).toBe("2");
    expect(contaDoBanco(contas, "nubank.com.br")?.id).toBe("1");
  });
  it("conta única vale; nenhuma ou duas candidatas, o dono escolhe", () => {
    expect(contaDoBanco([{ id: "9", nome: "Principal" }], "nubank.com.br")?.id).toBe("9");
    expect(contaDoBanco(contas, "bradesco.com.br")).toBeNull();
    expect(contaDoBanco([{ id: "1", nome: "Nubank PF" }, { id: "2", nome: "Nubank PJ" }], "nubank.com.br")).toBeNull();
  });
});

describe("cobrança: o que ainda vai ser pago", () => {
  const HOJE = "2026-10-06";
  it("o boleto do C6 de 06/10 vira conta a pagar com valor, vencimento e emissor", () => {
    expect(lerCobranca("Boleto emitido para você", "C6 Bank informa boleto emitido por Banco Santander no valor de R$ 265,63, com vencimento em 09/11/2026.", HOJE)).toEqual({
      direcao: "pagar", valor: 26563, vencimento: "2026-11-09", fatura: false, finalDoCartao: null, emissor: "Banco Santander",
    });
  });

  it("a fatura do Itaú sabe que é fatura e de qual cartão", () => {
    const c = lerCobranca("A fatura do seu cartão final 6093 fechou", "Fatura do cartão Itaú final 6093 fechou em R$ 391,90, com vencimento em 13/10.", HOJE);
    expect(c).toMatchObject({ direcao: "pagar", valor: 39190, vencimento: "2026-10-13", fatura: true, finalDoCartao: "6093" });
    const cartoes = [{ id: "k1", nome: "Itaú Click Múltiplo Plat final 6093" }, { id: "k2", nome: "Nubank" }];
    expect(cartaoDaFatura(cartoes, c!, "itau.com.br")?.id).toBe("k1");
    // o único cartão cadastrado é de OUTRO banco: a fatura não é dele
    expect(cartaoDaFatura([{ id: "k2", nome: "Nubank" }], { ...c!, finalDoCartao: null }, "itau.com.br")).toBeNull();
  });

  it("movimentação já feita, sem valor ou sem vencimento não é cobrança", () => {
    expect(lerCobranca("Você recebeu um Pix", "Você recebeu um Pix de R$ 50,00 de Ana.", HOJE)).toBeNull();
    expect(lerCobranca("Boleto emitido", "Seu boleto está disponível no app.", HOJE)).toBeNull();
    expect(lerCobranca("Boleto emitido", "Valor R$ 10,00.", HOJE)).toBeNull();
    expect(lerCobranca("Novidades", "Conheça o cartão, R$ 0,00 de anuidade, vencimento 10/10", HOJE)).toBeNull();
  });

  it("vencimento sem ano é o próximo; data impossível não vale", () => {
    expect(vencimentoDoTexto("vencimento em 13/10", HOJE)).toBe("2026-10-13");
    expect(vencimentoDoTexto("vence dia 05/01", "2026-12-20")).toBe("2027-01-05");
    expect(vencimentoDoTexto("vencimento: 09/11/26", HOJE)).toBe("2026-11-09");
    expect(vencimentoDoTexto("vencimento 40/13", HOJE)).toBeNull();
  });

  it("a receber também existe", () => {
    expect(lerCobranca("Pix agendado para você", "Pix agendado para você de R$ 1.000,00, vencimento 10/10/2026", HOJE)).toMatchObject({ direcao: "receber", valor: 100000 });
  });
});

describe("pagamento que quita uma conta em aberto", () => {
  const abertas = [
    { id: "b1", direcao: "pagar" as const, valor: 26563, vencimento: "2026-11-09" },
    { id: "b2", direcao: "pagar" as const, valor: 5000, vencimento: "2026-10-10" },
    { id: "r1", direcao: "receber" as const, valor: 5000, vencimento: "2026-10-10" },
  ];
  it("mesmo valor, mesmo sentido, vencimento perto: quita em vez de lançar de novo", () => {
    expect(contaQueEstePagamentoQuita(abertas, { natureza: "despesa", valor: 26563, contraparte: null }, "2026-11-08")?.id).toBe("b1");
    expect(contaQueEstePagamentoQuita(abertas, { natureza: "receita", valor: 5000, contraparte: null }, "2026-10-09")?.id).toBe("r1");
  });
  it("longe do vencimento ou ambíguo, não quita nada", () => {
    expect(contaQueEstePagamentoQuita(abertas, { natureza: "despesa", valor: 26563, contraparte: null }, "2026-10-06")).toBeNull();
    expect(contaQueEstePagamentoQuita([...abertas, { id: "b3", direcao: "pagar" as const, valor: 5000, vencimento: "2026-10-12" }], { natureza: "despesa", valor: 5000, contraparte: null }, "2026-10-10")).toBeNull();
  });
});
