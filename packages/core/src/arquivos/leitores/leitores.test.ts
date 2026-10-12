import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Cada leitor do extrator universal chamado DIRETO, com os arquivos pequenos de
 * `__fixtures__` (o que a C3 pede: "cada leitor mora no seu arquivo, com teste
 * próprio"). O `extrair.test.ts` cobre a tabela do C3 pelo extrator inteiro;
 * aqui fica o contrato de cada leitor, para uma troca de biblioteca quebrar o
 * teste do leitor, e não só o de ponta a ponta. O compactado e o e-mail têm
 * arquivo próprio (`compactado.test.ts`, `email.test.ts`).
 */

vi.mock("@orbita/db", () => ({ db: {} }));

import { conteudoDoContainer, lerDoc, lerDocx, lerOdp, lerOdt, lerPptx, lerRtf } from "./office";
import { lerPlanilha, planilhaComoCsv } from "./planilha";
import { lerIcs, lerNfe, lerVcf, textoDosEventos } from "./estruturado";
import { lerAudio, lerVideo } from "./midia";
import { htmlParaTexto, linksDeDocumento } from "./html";
import { CompactadoRecusadoError, type Limites } from "../tipos";

const FX = join(__dirname, "../__fixtures__");
const fx = (n: string) => readFileSync(join(FX, n));
const LIMITES: Limites = { linhasMax: 2000, zipMaxArquivos: 200, zipMaxBytes: 200 * 1024 * 1024, zipProfundidade: 3, arquivoMaxBytes: 50 * 1024 * 1024, transcreverAudio: true, quadrosDoVideo: 0, seteZip: "", textoMax: 2_000_000 };
const orcamento = () => ({ bytes: LIMITES.zipMaxBytes, arquivos: LIMITES.zipMaxArquivos });

describe("office.ts", () => {
  it("DOCX e ODT: texto e tabela Markdown", async () => {
    const docx = await lerDocx(fx("contrato.docx"), LIMITES, orcamento());
    expect(docx.texto).toContain("| Manutenção | R$ 300 |");
    expect(docx.tabelas).toBe(1);
    expect(docx.resumo).toMatch(/^Documento do Word com \d+ palavra/);
    const odt = await lerOdt(fx("contrato.odt"), LIMITES, orcamento());
    expect(odt.texto).toContain("Vigência de doze meses");
  });

  it("DOC antigo e RTF", async () => {
    expect((await lerDoc(fx("contrato.doc"))).texto).toContain("Contrato de prestação de serviços");
    expect(lerRtf(fx("contrato.rtf")).texto).toContain("R$ 1.250,00");
  });

  it("PPTX e ODP: um slide por parte, com as notas", async () => {
    const pptx = await lerPptx(fx("apresentacao.pptx"), LIMITES, orcamento());
    expect(pptx.partes).toHaveLength(2);
    expect(pptx.partes[0]).toContain("Notas: Lembrar de citar o orçamento");
    expect((await lerOdp(fx("apresentacao.odp"), LIMITES, orcamento())).texto).toContain("Meta: 500 clientes no trimestre");
  });

  it("o contêiner Office é inflado CONTANDO: orçamento pequeno recusa antes de qualquer biblioteca abrir", async () => {
    await expect(conteudoDoContainer(fx("contrato.docx"), LIMITES, { bytes: 10, arquivos: 200 })).rejects.toBeInstanceOf(CompactadoRecusadoError);
  });
});

describe("planilha.ts", () => {
  it("cada aba vira tabela com o nome; o corte de linhas é avisado pelo NÚMERO da aba (o nome é de quem montou)", () => {
    const r = lerPlanilha(fx("planilha.xlsx"), 2000, "Planilha do Excel");
    expect(r.texto).toContain("## Aba: Vendas");
    expect(r.partes).toHaveLength(2);
    const cortada = lerPlanilha(fx("planilha.xlsx"), 1, "Planilha do Excel");
    expect(cortada.avisos.join(" ")).toMatch(/A aba 1 tem \d+ linhas; li as primeiras 1/);
    expect(cortada.avisos.join(" ")).not.toMatch(/Vendas/);
  });

  it("planilhaComoCsv: todas as linhas, separador ';', para o leitor de extrato", () => {
    const c = planilhaComoCsv(fx("planilha.xlsx"));
    expect(c.abas).toBe(2);
    expect(c.texto).toContain("Fevereiro;2300");
    expect(c.texto).not.toContain("|");
  });
});

describe("estruturado.ts", () => {
  it("ICS: evento com título, início, local, organizador e a descrição desdobrada", () => {
    const [e] = lerIcs(fx("convite.ics").toString("utf8"));
    expect(e).toMatchObject({ titulo: "Reunião de alinhamento", inicio: "2026-10-15T14:00:00Z", local: "Sala 3", organizador: "Fulana" });
    expect(textoDosEventos([e!])).toContain("orçamento, contratações e próximos passos");
  });

  it("VCF: nome, telefone, e-mail, empresa e aniversário", () => {
    expect(lerVcf(fx("contato.vcf").toString("utf8"))[0]).toMatchObject({ nome: "Maria Souza", telefones: ["+55 11 99999-8888"], emails: ["maria@exemplo.com"], empresa: "Exemplo Ltda", aniversario: "1990-04-12" });
  });

  it("NF-e: emitente, CNPJ, valor e itens", () => {
    const n = lerNfe(fx("nota.xml").toString("utf8"));
    expect(n).toMatchObject({ emitente: "Mercado Bom Preço Ltda", cnpj: "12345678000195", valorTotal: 63.7 });
    expect(n.itens.some((i) => i.descricao.includes("Café"))).toBe(true);
  });
});

describe("midia.ts", () => {
  const deps = { transcrever: vi.fn(async () => ({ texto: "oi, o orçamento ficou em dois mil", provedor: "teste" })), descreverQuadro: vi.fn(async () => "uma sala") };

  it("áudio: transcrito pela dependência; desligado, só o tamanho", async () => {
    const r = await lerAudio(fx("recado.wav"), "audio/wav", "recado.wav", { transcrever: true, deps });
    expect(r.lido).toBe(true);
    expect(r.texto).toContain("orçamento");
    const off = await lerAudio(fx("recado.wav"), "audio/wav", "recado.wav", { transcrever: false, deps });
    expect(off.lido).toBe(false);
    expect(off.resumo).toMatch(/desligada/);
  });

  it("vídeo: o áudio separado e transcrito; falha da separação vira aviso, não exceção", async () => {
    const ok = await lerVideo(fx("video.mp4"), "video/mp4", "v.mp4", { transcrever: true, quadros: 0, deps, extrairAudio: async () => new Uint8Array([1]) });
    expect(ok.texto).toContain("Fala transcrita");
    const falhou = await lerVideo(fx("video.mp4"), "video/mp4", "v.mp4", { transcrever: true, quadros: 0, deps, extrairAudio: async () => { throw new Error("serviço de voz fora do ar"); } });
    expect(falhou.lido).toBe(false);
    expect(falhou.avisos.join(" ")).toMatch(/serviço de voz fora do ar/);
  });
});

describe("html.ts", () => {
  it("sem script, estilo nem imagem remota; tabela em Markdown; links guardados à parte", () => {
    const h = htmlParaTexto('<p>Olá</p><script>roubar()</script><img src="https://pixel/a.gif"><table><tr><td>Luz</td><td>R$ 90</td></tr></table><a href="https://drive.google.com/file/d/1/view">doc</a>');
    expect(h.texto).not.toMatch(/roubar|pixel/);
    expect(h.texto).toContain("| Luz | R$ 90 |");
    expect(h.links).toEqual(["https://drive.google.com/file/d/1/view"]);
    expect(linksDeDocumento(h.texto, h.links)).toEqual(["https://drive.google.com/file/d/1/view"]);
  });
});
