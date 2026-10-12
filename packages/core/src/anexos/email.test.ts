import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O e-mail inteiro (C1) e a escolha do anexo: a conta é achada procurando o
 * id em todas (Gmail e Outlook), o corpo HTML vira texto sem recurso remoto, e
 * o anexo é escolhido por id, posição ou nome, sem chutar quando é ambíguo.
 */

vi.mock("@orbita/db", () => ({ db: {} }));
const contas = vi.hoisted(() => ({
  google: [] as { conexao: { id: string; accountLabel: string | null; provider: string }; token: string }[],
  microsoft: [] as { conexao: { id: string; accountLabel: string | null; provider: string }; token: string }[],
}));
vi.mock("../connectors/store", () => ({ tokensDeTodasAsContas: async (cid: "google" | "microsoft") => contas[cid] }));

const gmail = vi.hoisted(() => ({ lerMensagemCompleta: vi.fn(), baixarAnexoGmail: vi.fn() }));
vi.mock("../connectors/google", async (orig) => ({ ...(await orig<typeof import("../connectors/google")>()), ...gmail }));
const outlook = vi.hoisted(() => ({ lerMensagemCompletaOutlook: vi.fn(), baixarAnexoOutlook: vi.fn() }));
vi.mock("../connectors/microsoft", async (orig) => ({ ...(await orig<typeof import("../connectors/microsoft")>()), ...outlook }));

import { contasParaProcurar, EmailNaoEncontradoError, escolherAnexo, lerEmail, LeituraDoEmailFalhouError, motivoDaFalha, servicoProvavel, type AnexoInfo } from "./email";
import { anexosDasPartes, type GmailParte } from "../connectors/google";
import { anexosDoGraph } from "../connectors/microsoft";

const conexao = (id: string, label: string, provider = "google") => ({ conexao: { id, accountLabel: label, provider }, token: `tok-${id}` });

beforeEach(() => {
  vi.clearAllMocks();
  contas.google = [conexao("g1", "pessoal@gmail.com"), conexao("g2", "trabalho@empresa.com")];
  contas.microsoft = [conexao("m1", "wesley@corp.com", "microsoft")];
});

describe("qual conta tem o e-mail", () => {
  it("o formato do id diz por onde começar", () => {
    expect(servicoProvavel("18c2f0a1b2c3d4e5")).toBe("gmail");
    expect(servicoProvavel("AAMkAGI2TG93AAA=" + "x".repeat(80))).toBe("outlook");
    expect(servicoProvavel("???")).toBeNull();
  });

  it("procura em todas as contas e devolve a primeira que tem o e-mail", async () => {
    gmail.lerMensagemCompleta.mockImplementation(async (token: string) => {
      if (token !== "tok-g2") throw new Error("Google API 404");
      return { id: "18c2f0a1b2c3d4e5", de: "Fulana <f@x.com>", para: ["eu@x.com"], cc: [], data: "d", assunto: "Contrato", textoPuro: "", html: '<p>Olá</p><script>roubar()</script><img src="https://pixel.example/a.gif"><a href="https://drive.google.com/file/d/1/view">doc</a>', anexos: [{ id: "1", nome: "contrato.pdf", tipo: "application/pdf", tamanho: 10, embutido: false }], link: null };
    });
    const { email, conta } = await lerEmail("u1", "18c2f0a1b2c3d4e5");
    expect(conta.conexao.id).toBe("g2");
    expect(email.conta).toBe("trabalho@empresa.com");
    expect(email.corpo).toBe("Olá\n\ndoc");
    expect(email.corpo).not.toMatch(/roubar|pixel/);
    expect(email.links).toEqual(["https://drive.google.com/file/d/1/view"]);
    expect(outlook.lerMensagemCompletaOutlook).not.toHaveBeenCalled();
  });

  it("id que não está em lugar nenhum vira uma frase, não um 404 cru", async () => {
    gmail.lerMensagemCompleta.mockRejectedValue(new Error("Google API 404"));
    outlook.lerMensagemCompletaOutlook.mockRejectedValue(new Error("Microsoft Graph 404"));
    await expect(lerEmail("u1", "18c2f0a1b2c3d4e5")).rejects.toThrow(/nenhuma das 3 conta/);
  });

  it("token vencido, limite e rede NÃO viram 'não achei': a frase diz o que houve (M3)", async () => {
    gmail.lerMensagemCompleta.mockImplementation(async (token: string) => {
      if (token === "tok-g1") throw new Error("Google API 401: invalid_token");
      throw new Error("Google API 429: rate limit");
    });
    outlook.lerMensagemCompletaOutlook.mockRejectedValue(new TypeError("fetch failed"));
    const erro = (await lerEmail("u1", "18c2f0a1b2c3d4e5").catch((e: unknown) => e)) as Error;
    expect(erro).toBeInstanceOf(LeituraDoEmailFalhouError);
    expect(erro.message).toMatch(/pessoal@gmail\.com está com o acesso vencido/);
    expect(erro.message).toMatch(/trabalho@empresa\.com pediu para esperar/);
    expect(erro.message).toMatch(/wesley@corp\.com não respondeu agora/);
    expect(erro.message).not.toMatch(/Não achei/);
  });

  it("controle: 404 numa e 400 na outra (id de outro serviço) continuam sendo 'não achei' (M3)", async () => {
    gmail.lerMensagemCompleta.mockRejectedValue(new Error("Google API 404: not found"));
    outlook.lerMensagemCompletaOutlook.mockRejectedValue(new Error("Microsoft Graph 400: ErrorInvalidIdMalformed"));
    await expect(lerEmail("u1", "18c2f0a1b2c3d4e5")).rejects.toBeInstanceOf(EmailNaoEncontradoError);
    expect(motivoDaFalha(new Error("Google API 403"))).toBe("acesso");
    expect(motivoDaFalha(new Error("Microsoft Graph 503"))).toBe("rede");
  });

  it("'na do trabalho' procura só naquela; pedido que não casa com nenhuma diz quais existem", async () => {
    const [so] = await contasParaProcurar("u1", { id: "x", conta: "trabalho" });
    expect(so!.conexao.id).toBe("g2");
    await expect(contasParaProcurar("u1", { id: "x", conta: "faculdade" })).rejects.toThrow(/Contas: /);
  });
});

describe("qual anexo o dono quis dizer", () => {
  const anexos: AnexoInfo[] = [
    { id: "0.1", nome: "logo.png", tipo: "image/png", tamanho: 70, embutido: true, link: null },
    { id: "1", nome: "Contrato assinado.pdf", tipo: "application/pdf", tamanho: 10, embutido: false, link: null },
    { id: "2", nome: "Planilha de custos.xlsx", tipo: "x", tamanho: 10, embutido: false, link: null },
    { id: "3", nome: "Contrato antigo.pdf", tipo: "application/pdf", tamanho: 10, embutido: false, link: null },
  ];
  it("por id, por posição (sem contar a imagem do corpo) e por pedaço do nome", () => {
    expect(escolherAnexo(anexos, "2")).toMatchObject({ nome: "Planilha de custos.xlsx" });
    expect(escolherAnexo(anexos, "1")).toMatchObject({ nome: "Contrato assinado.pdf" });
    expect(escolherAnexo(anexos, "planilha")).toMatchObject({ id: "2" });
    expect(escolherAnexo(anexos, "0.1")).toMatchObject({ nome: "logo.png" });
  });
  it("dois casando é pergunta, não chute", () => {
    expect(escolherAnexo(anexos, "contrato")).toEqual({ erro: expect.stringMatching(/Mais de um anexo.*Diga qual/) });
    expect(escolherAnexo([], "x")).toEqual({ erro: "Esse e-mail não tem anexo." });
  });
});

describe("anexos de cada provedor", () => {
  it("Gmail: o id é o partId (estável), o corpo não entra, a imagem embutida entra marcada", () => {
    const payload: GmailParte = {
      mimeType: "multipart/mixed",
      parts: [
        { partId: "0", mimeType: "multipart/related", parts: [
          { partId: "0.0", mimeType: "text/html", body: { size: 100, data: "PGI+" } },
          { partId: "0.1", mimeType: "image/png", filename: "", headers: [{ name: "Content-ID", value: "<logo@x>" }, { name: "Content-Disposition", value: "inline" }], body: { size: 70, attachmentId: "ANGjdJ_muda_toda_hora" } },
        ] },
        { partId: "1", mimeType: "application/pdf", filename: "boleto.pdf", headers: [{ name: "Content-Disposition", value: "attachment" }], body: { size: 5000, attachmentId: "ANGjdJ_outro" } },
      ],
    };
    expect(anexosDasPartes(payload)).toEqual([
      { id: "0.1", nome: "embutido-logo@x", tipo: "image/png", tamanho: 70, embutido: true },
      { id: "1", nome: "boleto.pdf", tipo: "application/pdf", tamanho: 5000, embutido: false },
    ]);
  });

  it("Outlook: e-mail anexado vira item (o Graph entrega o EML), e link do OneDrive fica como link", () => {
    expect(anexosDoGraph([
      { "@odata.type": "#microsoft.graph.fileAttachment", id: "A1", name: "nota.pdf", contentType: "application/pdf", size: 10, isInline: false },
      { "@odata.type": "#microsoft.graph.itemAttachment", id: "A2", name: "Re: proposta", size: 20 },
      { "@odata.type": "#microsoft.graph.referenceAttachment", id: "A3", name: "Plano.docx", sourceUrl: "https://empresa-my.sharepoint.com/x" },
    ])).toEqual([
      { id: "A1", nome: "nota.pdf", tipo: "application/pdf", tamanho: 10, embutido: false, item: false, link: null, referencia: false },
      { id: "A2", nome: "Re: proposta", tipo: "message/rfc822", tamanho: 20, embutido: false, item: true, link: null, referencia: false },
      { id: "A3", nome: "Plano.docx", tipo: "application/octet-stream", tamanho: 0, embutido: false, item: false, link: "https://empresa-my.sharepoint.com/x", referencia: true },
    ]);
  });

  it("Outlook: o anexo-link do v1.0 (sem sourceUrl) é marcado pelo @odata.type e nunca é baixado (I15)", async () => {
    // o v1.0 nem devolve o `sourceUrl`: sem a marca pelo tipo, o `/$value` falhava com erro do Graph
    const [ref] = anexosDoGraph([{ "@odata.type": "#microsoft.graph.referenceAttachment", id: "A9", name: "Plano.docx" }]);
    expect(ref).toMatchObject({ referencia: true, link: null });
    const real = await vi.importActual<typeof import("../connectors/microsoft")>("../connectors/microsoft");
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      chamadas.push(String(url));
      return Response.json({ value: [{ "@odata.type": "#microsoft.graph.referenceAttachment", id: "A9", name: "Plano.docx" }] });
    }));
    try {
      await expect(real.baixarAnexoOutlook("t", "m1", "A9")).rejects.toThrow(/link para um documento compartilhado/);
      // só a lista: o `$value` nem foi pedido
      expect(chamadas.some((u) => u.includes("$value"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Outlook: a URL do anexo-link vem do beta; se o beta falhar, continua link sem URL (I15)", async () => {
    const real = await vi.importActual<typeof import("../connectors/microsoft")>("../connectors/microsoft");
    const resposta = (falharBeta: boolean) => vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/beta/")) return falharBeta ? new Response("nao", { status: 500 }) : Response.json({ sourceUrl: "https://empresa-my.sharepoint.com/plano" });
      if (u.includes("/attachments")) return Response.json({ value: [{ "@odata.type": "#microsoft.graph.referenceAttachment", id: "A9", name: "Plano.docx" }] });
      return Response.json({ id: "m1", subject: "Plano", body: { contentType: "text", content: "veja" }, internetMessageHeaders: [{ name: "Authentication-Results", value: "mx; dkim=pass header.d=empresa.com" }] });
    });
    vi.stubGlobal("fetch", resposta(false));
    try {
      const m = await real.lerMensagemCompletaOutlook("t", "m1");
      expect(m.anexos[0]).toMatchObject({ referencia: true, link: "https://empresa-my.sharepoint.com/plano" });
      expect(m.autenticacao).toMatch(/dkim=pass/);
      vi.stubGlobal("fetch", resposta(true));
      const sem = await real.lerMensagemCompletaOutlook("t", "m1");
      expect(sem.anexos[0]).toMatchObject({ referencia: true, link: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
