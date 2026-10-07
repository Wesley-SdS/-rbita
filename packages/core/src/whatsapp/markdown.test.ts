import { describe, expect, it } from "vitest";
import { paraWhatsapp } from "./markdown";

describe("markdown do modelo no formato do WhatsApp", () => {
  it("negrito, título, lista e link", () => {
    const md = "## Resumo do dia\n\n**3 contas** vencem hoje:\n- Luz\n- Água\n\nVeja [o boleto](https://banco.com/b).";
    expect(paraWhatsapp(md)).toBe("*Resumo do dia*\n\n*3 contas* vencem hoje:\n• Luz\n• Água\n\nVeja o boleto (https://banco.com/b).");
  });

  it("o caso real: título repetido e cabeçalho com cerquilha", () => {
    expect(paraWhatsapp("# Teste de diarização\n\n## Resumo\n### Resumo\nA reunião começou.")).toBe("*Teste de diarização*\n\n*Resumo*\n\nA reunião começou.");
  });

  it("tabela vira linhas com ponto e o separador some", () => {
    expect(paraWhatsapp("| Conta | Valor |\n|---|---|\n| Luz | R$ 120 |")).toBe("Conta · Valor\nLuz · R$ 120");
  });

  it("não mexe no que já está no formato dele, nem dentro de bloco de código", () => {
    expect(paraWhatsapp("*já em negrito* e _itálico_")).toBe("*já em negrito* e _itálico_");
    expect(paraWhatsapp("```\n## não é título\n- nem lista\n```")).toBe("```\n## não é título\n- nem lista\n```");
  });

  it("travessão vira vírgula entre palavras e hífen solto (avisos e respostas)", () => {
    expect(paraWhatsapp("Caiu um Pix de R$ 14.435,98 — não precisa fazer nada.")).toBe("Caiu um Pix de R$ 14.435,98, não precisa fazer nada.");
    expect(paraWhatsapp("Água – 5ª")).toBe("Água, 5ª");
    expect(paraWhatsapp("das 10—12h")).toBe("das 10-12h");
    // dentro de bloco de código fica como está
    expect(paraWhatsapp("```\na — b\n```")).toBe("```\na — b\n```");
  });

  it("título em negrito ganha linha em branco antes e depois", () => {
    expect(paraWhatsapp("*E-mail de C6 Empresas*\nCaiu um Pix.")).toBe("*E-mail de C6 Empresas*\n\nCaiu um Pix.");
    expect(paraWhatsapp("Pronto.\n*Esperando você confirmar:*\n1. Apagar X")).toBe("Pronto.\n\n*Esperando você confirmar:*\n\n1. Apagar X");
    // negrito no meio da frase não é título
    expect(paraWhatsapp("Tem *3 contas* hoje.")).toBe("Tem *3 contas* hoje.");
  });

  it("texto simples sai igual, e linhas em branco em excesso encolhem", () => {
    expect(paraWhatsapp("Pronto, lancei R$ 45,90 no mercado.")).toBe("Pronto, lancei R$ 45,90 no mercado.");
    expect(paraWhatsapp("a\n\n\n\nb")).toBe("a\n\nb");
  });
});
