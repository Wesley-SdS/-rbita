import { describe, expect, it } from "vitest";
import { estadoDoServico, ollamaEmUso, vozLocalEmUso, type UsoDoOllama } from "./servicos-locais";

const soNuvem: UsoDoOllama = {
  politicaUsaLocal: false,
  alcancavel: true,
  embeddingsProvider: "auto",
  temChaveDeEmbedding: true,
  ocrVisionProvider: "auto",
  temChaveDeNuvem: true,
};

describe("ollamaEmUso", () => {
  it("casa em assinatura, com chave de embedding: ninguém usa o Ollama", () => {
    expect(ollamaEmUso(soNuvem)).toBe(false);
  });

  it("a ordem do dono usar o local basta", () => {
    expect(ollamaEmUso({ ...soNuvem, politicaUsaLocal: true })).toBe(true);
  });

  it("embedding automático sem chave de nuvem cai no local", () => {
    expect(ollamaEmUso({ ...soNuvem, temChaveDeEmbedding: false })).toBe(true);
    expect(ollamaEmUso({ ...soNuvem, embeddingsProvider: "local" })).toBe(true);
  });

  it("OCR em nuvem sem chave NÃO conta como uso do local (E5)", () => {
    expect(ollamaEmUso({ ...soNuvem, ocrVisionProvider: "nuvem", temChaveDeNuvem: false })).toBe(false);
    expect(ollamaEmUso({ ...soNuvem, ocrVisionProvider: "local" })).toBe(true);
  });

  it("Ollama inalcançável nunca está em uso, mesmo pedido", () => {
    expect(ollamaEmUso({ ...soNuvem, alcancavel: false, embeddingsProvider: "local", politicaUsaLocal: true })).toBe(false);
  });
});

describe("vozLocalEmUso", () => {
  it("só fica de fora com TTS fixo na nuvem, wake no navegador e AssemblyAI", () => {
    expect(vozLocalEmUso({ ttsProvider: "edge", wakeEngine: "navegador", temChaveDeTranscricao: true })).toBe(false);
  });

  it("em auto o serviço é a reserva, então conta como usado", () => {
    expect(vozLocalEmUso({ ttsProvider: "auto", wakeEngine: "navegador", temChaveDeTranscricao: true })).toBe(true);
    expect(vozLocalEmUso({ ttsProvider: "edge", wakeEngine: "auto", temChaveDeTranscricao: true })).toBe(true);
    expect(vozLocalEmUso({ ttsProvider: "edge", wakeEngine: "navegador", temChaveDeTranscricao: false })).toBe(true);
  });
});

describe("estadoDoServico", () => {
  it("serviço sem uso não vira falha", () => {
    expect(estadoDoServico(false, false)).toBe("nao_usado");
    expect(estadoDoServico(true, false)).toBe("down");
    expect(estadoDoServico(true, true)).toBe("up");
  });
});
